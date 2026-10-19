/**
 * Minimal WebDAV (class 1) endpoint that exposes the share directory as a
 * mountable drive:
 *   Windows:  net use Z: http://host:8787/dav
 *   macOS:    Finder → Go → Connect to Server → http://host:8787/dav
 *   Linux:    mount -t davfs http://host:8787/dav /mnt/dex
 *
 * Supported: OPTIONS, PROPFIND (depth 0/1), GET/HEAD (with ranges), PUT,
 * DELETE, MKCOL, MOVE, LOCK/UNLOCK (advisory tokens).
 */
import { rename, stat } from 'node:fs/promises';
import path from 'node:path';
import { HttpError, humanBytes, readBody, safeJoin, text } from './util.js';

const escapeXml = (value) => String(value)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

const hrefFor = (relative, isDir) => {
  const encoded = relative.split('/').map((part) => encodeURIComponent(part)).join('/');
  return `/dav/${encoded}${isDir && !encoded.endsWith('/') ? '/' : ''}`;
};

export function createWebdav({ files, runtime, token = null }) {
  const authorized = (req) => {
    if (!token) return true;
    const header = req.headers.authorization || '';
    if (header.startsWith('Bearer ')) return header.slice(7) === token;
    if (header.startsWith('Basic ')) {
      const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
      const password = decoded.slice(decoded.indexOf(':') + 1);
      return password === token;
    }
    return false;
  };

  const listingToXml = async (relative) => {
    const info = await stat(safeJoin(files.shareDir, relative));
    const isDir = info.isDirectory();
    const entries = [{ relative, info, isDir }];
    if (isDir) {
      const listing = await files.list(relative);
      for (const item of listing.items) {
        entries.push({
          relative: item.path,
          info: { size: item.size, mtime: new Date(item.modified) },
          isDir: item.kind === 'folder',
          mime: item.mime,
        });
      }
    }
    const responses = entries.map(({ relative: rel, info: meta, isDir: dir, mime }) => {
      const displayName = rel === '' ? 'Android DEX share' : path.posix.basename(rel);
      return `<d:response>
  <d:href>${escapeXml(hrefFor(rel, dir))}</d:href>
  <d:propstat>
    <d:prop>
      <d:displayname>${escapeXml(displayName)}</d:displayname>
      <d:getlastmodified>${meta.mtime.toUTCString()}</d:getlastmodified>
      <d:getcontentlength>${dir ? 0 : meta.size}</d:getcontentlength>
      <d:getcontenttype>${dir ? 'inode/directory' : escapeXml(mime || files.mimeFor(displayName))}</d:getcontenttype>
      <d:resourcetype>${dir ? '<d:collection/>' : ''}</d:resourcetype>
      <d:supportedlock><d:lockentry><d:lockscope><d:exclusive/></d:lockscope><d:locktype><d:write/></d:locktype></d:lockentry></d:supportedlock>
    </d:prop>
    <d:status>HTTP/1.1 200 OK</d:status>
  </d:propstat>
</d:response>`;
    });
    return `<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:">
${responses.join('\n')}
</d:multistatus>`;
  };

  return async function handleWebdav(req, res, urlPath) {
    if (!authorized(req)) {
      res.writeHead(401, { 'www-authenticate': 'Basic realm="Android DEX", Bearer', 'content-type': 'text/plain' });
      res.end('Authentication required. Use any username and the bridge token as the password.\n');
      return true;
    }
    const relative = decodeURIComponent(urlPath.replace(/^\/dav\/?/, '')).replace(/^\/+/, '');
    const method = req.method.toUpperCase();

    try {
      if (method === 'OPTIONS') {
        res.writeHead(200, {
          DAV: '1, 2', 'MS-Author-Via': 'DAV', Allow: 'OPTIONS, PROPFIND, GET, HEAD, PUT, DELETE, MKCOL, MOVE, LOCK, UNLOCK',
          'content-length': '0',
        });
        res.end();
        return true;
      }

      if (method === 'PROPFIND') {
        const depth = String(req.headers.depth || '1');
        if (depth === '0') {
          const xml = await listingToXml(relative).then((full) => {
            const first = full.match(/<d:response>[\s\S]*?<\/d:response>/)[0];
            return `<?xml version="1.0" encoding="utf-8"?>\n<d:multistatus xmlns:d="DAV:">\n${first}\n</d:multistatus>`;
          });
          text(res, 207, xml, 'application/xml; charset=utf-8');
        } else {
          const xml = await listingToXml(relative);
          text(res, 207, xml, 'application/xml; charset=utf-8');
        }
        return true;
      }

      if (method === 'GET' || method === 'HEAD') {
        const file = await files.read(relative);
        const range = req.headers.range;
        if (range) {
          const match = /bytes=(\d*)-(\d*)/.exec(range);
          const start = match && match[1] ? Number(match[1]) : 0;
          const end = match && match[2] ? Number(match[2]) : file.size - 1;
          if (start >= file.size) {
            res.writeHead(416, { 'content-range': `bytes */${file.size}` });
            res.end();
            return true;
          }
          res.writeHead(206, {
            'content-type': file.mime, 'content-range': `bytes ${start}-${end}/${file.size}`,
            'content-length': end - start + 1, 'accept-ranges': 'bytes',
          });
          if (method === 'GET') file.stream().pipe(res);
          else res.end();
          return true;
        }
        res.writeHead(200, {
          'content-type': file.mime, 'content-length': file.size, 'accept-ranges': 'bytes',
          'last-modified': file.info.mtime.toUTCString(),
          'etag': `"${file.size}-${file.info.mtimeMs}"`,
        });
        if (method === 'GET') file.stream().pipe(res);
        else res.end();
        return true;
      }

      if (method === 'PUT') {
        const buffer = await readBody(req, { limit: 512 * 1024 * 1024, binary: true });
        await files.write(relative, buffer);
        runtime.audit('webdav.put', `${relative} · ${humanBytes(buffer.length)}`, 'files');
        res.writeHead(201, { 'content-length': '0' });
        res.end();
        return true;
      }

      if (method === 'MKCOL') {
        await files.mkdir(relative);
        res.writeHead(201, { 'content-length': '0' });
        res.end();
        return true;
      }

      if (method === 'DELETE') {
        await files.remove(relative);
        res.writeHead(204);
        res.end();
        return true;
      }

      if (method === 'MOVE') {
        const destination = req.headers.destination;
        if (!destination) throw new HttpError(400, 'Destination header is required');
        const target = decodeURIComponent(new URL(destination, 'http://localhost').pathname.replace(/^\/dav\/?/, ''));
        const from = safeJoin(files.shareDir, relative);
        const to = safeJoin(files.shareDir, target);
        await rename(from, to);
        runtime.emit('files.changed', { action: 'move', path: target });
        res.writeHead(201, { 'content-length': '0' });
        res.end();
        return true;
      }

      if (method === 'LOCK') {
        res.writeHead(200, {
          'content-type': 'application/xml; charset=utf-8',
          'lock-token': `<opaquelocktoken:${Date.now().toString(16)}>`,
        });
        res.end(`<?xml version="1.0" encoding="utf-8"?>
<d:prop xmlns:d="DAV:"><d:lockdiscovery><d:activelock>
<d:locktype><d:write/></d:locktype><d:lockscope><d:exclusive/></d:lockscope>
<d:depth>infinity</d:depth><d:timeout>Second-3600</d:timeout>
</d:activelock></d:lockdiscovery></d:prop>`);
        return true;
      }

      if (method === 'UNLOCK') {
        res.writeHead(204);
        res.end();
        return true;
      }

      throw new HttpError(405, `method ${method} not allowed`);
    } catch (error) {
      const status = error.status || 500;
      if (status === 500) runtime.logger.error('webdav', error.message);
      text(res, status, error.message || 'WebDAV error');
      return true;
    }
  };
}
