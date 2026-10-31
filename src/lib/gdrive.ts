import { google } from 'googleapis';
import { Readable } from 'stream';
import { db } from './db';
import { decrypt, encrypt } from './encryption';

const ROOT_FOLDER_NAME = 'Driveinary_Media';
const SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/userinfo.email',
];

export function getOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/api/auth/google/callback'
  );
}

export function getAuthUrl(state: string): string {
  const oauth2Client = getOAuth2Client();
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent select_account',
    state,
    scope: SCOPES,
  });
}

export async function handleOAuthCallback(code: string, ownerUserId: string) {
  const oauth2Client = getOAuth2Client();
  const { tokens } = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokens);

  if (!tokens.refresh_token) {
    throw new Error('No refresh token returned by Google. Re-consent is required.');
  }

  const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
  const userInfo = await oauth2.userinfo.get();
  const email = userInfo.data.email;

  if (!email) {
    throw new Error('Failed to retrieve user email from Google OAuth');
  }

  const drive = google.drive({ version: 'v3', auth: oauth2Client });

  // Locate or create the dedicated root folder
  let rootFolderId: string;
  const searchFolder = await drive.files.list({
    q: `(name = '${ROOT_FOLDER_NAME}' or name = 'DriveCloud_Media') and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: 'files(id, name)',
    spaces: 'drive',
  });

  if (searchFolder.data.files && searchFolder.data.files.length > 0) {
    rootFolderId = searchFolder.data.files[0].id!;
  } else {
    const createdFolder = await drive.files.create({
      requestBody: {
        name: ROOT_FOLDER_NAME,
        mimeType: 'application/vnd.google-apps.folder',
      },
      fields: 'id',
    });
    rootFolderId = createdFolder.data.id!;
  }

  // Get quota information
  const about = await drive.about.get({ fields: 'storageQuota' });
  const quota = about.data.storageQuota;
  const storageUsed = BigInt(quota?.usage || 0);
  const storageLimit = BigInt(quota?.limit || 5497558138880);

  const encryptedRefreshToken = encrypt(tokens.refresh_token);

  const existingAccount = await db.googleAccount.findUnique({ where: { email } });
  if (existingAccount?.ownerUserId && existingAccount.ownerUserId !== ownerUserId) {
    throw new Error('This Google Drive account is already linked to another owner.');
  }

  const account = await db.googleAccount.upsert({
    where: { email },
    create: {
      ownerUserId,
      email,
      refreshToken: encryptedRefreshToken,
      rootFolderId,
      storageUsed,
      storageLimit,
    },
    update: {
      ownerUserId,
      refreshToken: encryptedRefreshToken,
      rootFolderId,
      storageUsed,
      storageLimit,
      updatedAt: new Date(),
    },
  });

  return account;
}

export async function getDriveClient(accountId: string) {
  const account = await db.googleAccount.findUnique({
    where: { id: accountId },
  });

  if (!account) {
    throw new Error(`Google account not found for id: ${accountId}`);
  }

  const refreshToken = decrypt(account.refreshToken);
  const oauth2Client = getOAuth2Client();
  oauth2Client.setCredentials({ refresh_token: refreshToken });

  const drive = google.drive({ version: 'v3', auth: oauth2Client });
  return { drive, account };
}

export async function uploadStreamToDrive(
  accountId: string,
  filename: string,
  mimeType: string,
  stream: Readable,
  subfolderName?: string
) {
  const { drive, account } = await getDriveClient(accountId);

  let targetParentId = account.rootFolderId;

  if (subfolderName) {
    const cleanSubfolder = subfolderName.replace(/['\\]/g, '').trim();
    if (cleanSubfolder) {
      // Find or create subfolder under the root folder
      const searchSubfolder = await drive.files.list({
        q: `name = '${cleanSubfolder}' and '${account.rootFolderId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
        fields: 'files(id, name)',
        spaces: 'drive',
      });

      if (searchSubfolder.data.files && searchSubfolder.data.files.length > 0) {
        targetParentId = searchSubfolder.data.files[0].id!;
      } else {
        const createdSubfolder = await drive.files.create({
          requestBody: {
            name: cleanSubfolder,
            mimeType: 'application/vnd.google-apps.folder',
            parents: [account.rootFolderId],
          },
          fields: 'id',
        });
        targetParentId = createdSubfolder.data.id!;
      }
    }
  }

  // Stream upload directly to Google Drive
  const res = await drive.files.create({
    requestBody: {
      name: filename,
      parents: [targetParentId],
    },
    media: {
      mimeType,
      body: stream,
    },
    fields: 'id, name, size, mimeType',
  });

  const fileId = res.data.id!;

  return {
    fileId,
    name: res.data.name || filename,
    mimeType: res.data.mimeType || mimeType,
    size: Number(res.data.size || 0),
  };
}

export async function downloadStreamFromDrive(
  accountId: string,
  fileId: string,
  range?: string
) {
  const { drive } = await getDriveClient(accountId);
  const response = await drive.files.get(
    { fileId, alt: 'media' },
    {
      responseType: 'stream',
      ...(range ? { headers: { Range: range } } : {}),
    }
  );

  const headers = response.headers as Record<string, string | string[] | undefined>;
  return {
    stream: response.data as Readable,
    status: response.status,
    contentRange: typeof headers['content-range'] === 'string' ? headers['content-range'] : undefined,
    contentLength: typeof headers['content-length'] === 'string' ? headers['content-length'] : undefined,
    acceptRanges: typeof headers['accept-ranges'] === 'string' ? headers['accept-ranges'] : undefined,
  };
}

/** List image files in the DriveStack media root and its direct subfolders. */
export async function listImagesInMediaFolder(accountId: string) {
  const { drive, account } = await getDriveClient(accountId);
  const folders: Array<{ id: string; name: string }> = [];
  const images: Array<{ id: string; name: string; mimeType: string }> = [];

  async function listChildren(parentId: string) {
    let pageToken: string | undefined;
    do {
      const response = await drive.files.list({
        q: `'${parentId}' in parents and trashed = false`,
        pageSize: 1000,
        pageToken,
        orderBy: 'name',
        fields: 'nextPageToken,files(id,name,mimeType,trashed)',
        spaces: 'drive',
      });
      for (const file of response.data.files || []) {
        if (!file.id || !file.mimeType) continue;
        if (file.mimeType === 'application/vnd.google-apps.folder') {
          if (parentId === account.rootFolderId) folders.push({ id: file.id, name: file.name || 'Folder' });
        } else if (file.mimeType.startsWith('image/')) {
          images.push({ id: file.id, name: file.name || 'Unnamed image', mimeType: file.mimeType });
        }
      }
      pageToken = response.data.nextPageToken || undefined;
    } while (pageToken);
  }

  await listChildren(account.rootFolderId);
  for (const folder of folders) await listChildren(folder.id);
  return images;
}

/** List public-link permissions only after verifying the file is inside the media folder. */
export async function listAnyonePermissionsForAsset(accountId: string, fileId: string) {
  const { drive, account } = await getDriveClient(accountId);
  const fileResponse = await drive.files.get({ fileId, fields: 'id,parents,trashed' });
  const file = fileResponse.data;
  if (file.trashed) throw new Error('File is in the Google Drive trash');

  const parents = file.parents || [];
  let isInMediaFolder = parents.includes(account.rootFolderId);
  if (!isInMediaFolder) {
    for (const parentId of parents) {
      const parent = await drive.files.get({ fileId: parentId, fields: 'id,parents,mimeType,trashed' });
      if (!parent.data.trashed && parent.data.mimeType === 'application/vnd.google-apps.folder' &&
          (parent.data.parents || []).includes(account.rootFolderId)) {
        isInMediaFolder = true;
        break;
      }
    }
  }
  if (!isInMediaFolder) throw new Error('File is outside this account media folder; permission change blocked');

  const permissionsResponse = await drive.permissions.list({ fileId, fields: 'permissions(id,type,role)' });
  return (permissionsResponse.data.permissions || []).filter(
    (permission) => permission.type === 'anyone' && permission.id
  );
}

/** Remove only public-link permissions from a file verified inside the media folder. */
export async function revokeAnyonePermissionFromAsset(accountId: string, fileId: string) {
  const { drive } = await getDriveClient(accountId);
  const publicPermissions = await listAnyonePermissionsForAsset(accountId, fileId);
  for (const permission of publicPermissions) {
    await drive.permissions.delete({ fileId, permissionId: permission.id! });
  }
  return publicPermissions.length;
}


export async function deleteFileFromDrive(accountId: string, fileId: string) {
  const { drive } = await getDriveClient(accountId);
  await drive.files.delete({ fileId });
}

export async function createResumableUploadSession(
  accountId: string,
  filename: string,
  mimeType: string,
  sizeBytes: number,
  subfolderName?: string,
  origin?: string
) {
  const { drive, account } = await getDriveClient(accountId);
  const refreshToken = decrypt(account.refreshToken);
  const oauth2Client = getOAuth2Client();
  oauth2Client.setCredentials({ refresh_token: refreshToken });

  let targetParentId = account.rootFolderId;

  if (subfolderName) {
    const cleanSubfolder = subfolderName.replace(/['\\]/g, '').trim();
    if (cleanSubfolder) {
      const searchSubfolder = await drive.files.list({
        q: `name = '${cleanSubfolder}' and '${account.rootFolderId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
        fields: 'files(id, name)',
        spaces: 'drive',
      });

      if (searchSubfolder.data.files && searchSubfolder.data.files.length > 0) {
        targetParentId = searchSubfolder.data.files[0].id!;
      } else {
        const createdSubfolder = await drive.files.create({
          requestBody: {
            name: cleanSubfolder,
            mimeType: 'application/vnd.google-apps.folder',
            parents: [account.rootFolderId],
          },
          fields: 'id',
        });
        targetParentId = createdSubfolder.data.id!;
      }
    }
  }

  const reqHeaders: Record<string, string> = {
    'X-Upload-Content-Type': mimeType,
    'X-Upload-Content-Length': sizeBytes.toString(),
  };

  if (origin) {
    try {
      const parsed = new URL(origin);
      reqHeaders['Origin'] = `${parsed.protocol}//${parsed.host}`;
    } catch {
      reqHeaders['Origin'] = origin;
    }
  }

  const response = await oauth2Client.request({
    method: 'POST',
    url: 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable',
    headers: reqHeaders,
    data: {
      name: filename,
      parents: [targetParentId],
    },
  });

  const uploadUrl = response.headers.get('location');
  if (!uploadUrl) {
    throw new Error('Google Drive did not return a resumable upload URL.');
  }

  return {
    uploadUrl,
    targetParentId,
    accountId: account.id,
  };
}

export async function verifyUploadedFile(
  accountId: string,
  fileId: string,
  expectedSizeBytes: number,
  expectedMimeType: string
) {
  const { drive, account } = await getDriveClient(accountId);

  // Confirm that the uploaded file belongs to this DriveStack account's media folder.
  const fileResponse = await drive.files.get({
    fileId,
    fields: 'id,mimeType,size,parents,trashed',
  });
  const file = fileResponse.data;

  if (file.trashed) {
    throw new Error('The uploaded Google Drive file is in the trash');
  }

  const parentIds = file.parents || [];
  let belongsToAccountFolder = parentIds.includes(account.rootFolderId);

  // Uploads may be placed one level below the account's root media folder.
  if (!belongsToAccountFolder) {
    for (const parentId of parentIds) {
      const parentResponse = await drive.files.get({
        fileId: parentId,
        fields: 'id,mimeType,parents,trashed',
      });
      const parent = parentResponse.data;
      if (
        !parent.trashed &&
        parent.mimeType === 'application/vnd.google-apps.folder' &&
        (parent.parents || []).includes(account.rootFolderId)
      ) {
        belongsToAccountFolder = true;
        break;
      }
    }
  }

  if (!belongsToAccountFolder) {
    throw new Error("The Google Drive file is outside this account's DriveStack folder");
  }

  const actualSize = Number(file.size || 0);
  if (actualSize !== expectedSizeBytes || file.mimeType !== expectedMimeType) {
    throw new Error('Uploaded file metadata does not match the upload session');
  }

  // The file remains private in Google Drive. DriveStack serves it through
  // the authenticated Google Drive API using its branded /media/{id} route.
}
