/**
 * Shared filesystem: a real directory on the bridge host is exposed to the
 * desktop UI, to the CLI and as a WebDAV share (see webdav.js) so it can be
 * mounted as a drive on Windows, macOS and Linux.
 */
import { createReadStream } from 'node:fs';
import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { badRequest, humanBytes, notFound, safeJoin, uid } from '../util.js';

const MIME = {
  '.md': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.json': 'application/json',
  '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.opus': 'audio/opus', '.wav': 'audio/wav',
  '.pdf': 'application/pdf', '.zip': 'application/zip', '.apk': 'application/vnd.android.package-archive',
};

export const mimeFor = (name) => MIME[path.extname(name).toLowerCase()] || 'application/octet-stream';

const SAMPLE_FILES = {
  'Read Me.md': `# Android DEX share\n\nThis directory is mounted into **Android DEX** and exposed as a WebDAV drive.\n\n- Drop files here from your desktop, or from the Files panel in the console.\n- Drag files from the panel onto a mirrored app window to push them to the phone.\n- Mount it as a drive: see "Connect → Mount" in the console.\n`,
  'Documents/Q4-OKR.md': `# Q4 OKRs\n\n1. Latency p95 below 40 ms at 1080p60.\n2. Clipboard + file sync available on all three desktop platforms.\n3. Every release reproducible and signed.\n4. WCAG 2.2 AA for the desktop console.\n`,
  'Documents/phone-shortcuts.txt': `Ctrl+K          universal search\nCtrl+Shift+V    clipboard history\nCtrl+Alt+P      screenshot\nCtrl+Alt+R      start/stop recording\nCtrl+Shift+L    lock phone\n`,
  'Screenshots/.keep': '',
  'Notes/meeting-2026-10-14.md': `# Design review\n\n- Snap layouts need keyboard equivalents (Win+Left / Win+Right).\n- PiP should keep media audio, mute everything else by default.\n- Add per-app DPI presets: compact / default / large.\n`,
};

export async function initFiles(runtime, { shareDir }) {
  await mkdir(shareDir, { recursive: true });
  for (const [name, content] of Object.entries(SAMPLE_FILES)) {
    const target = safeJoin(shareDir, name);
    try {
      await stat(target);
    } catch {
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, content, 'utf8');
    }
  }

  const resolve = (relative, { mustExist = false } = {}) => {
    const absolute = safeJoin(shareDir, relative);
    return absolute;
  };

  const describe = async (relative) => {
    const absolute = resolve(relative);
    const info = await stat(absolute);
    return {
      id: 'f_' + Buffer.from(relative).toString('base64url').slice(0, 18),
      name: path.basename(absolute),
      path: relative.replace(/\\/g, '/'),
      dir: path.posix.dirname(relative.replace(/\\/g, '/')) === '.' ? '' : path.posix.dirname(relative.replace(/\\/g, '/')),
      size: info.size,
      sizeLabel: humanBytes(info.size),
      mime: info.isDirectory() ? 'inode/directory' : mimeFor(absolute),
      modified: info.mtime.toISOString(),
      kind: info.isDirectory() ? 'folder' : 'file',
    };
  };

  return {
    shareDir,
    resolve,
    mimeFor,

    async list(dir = '') {
      const absolute = resolve(dir);
      let entries;
      try {
        entries = await readdir(absolute, { withFileTypes: true });
      } catch (error) {
        if (error.code === 'ENOENT') throw notFound('directory not found');
        throw error;
      }
      const items = [];
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;
        const relative = path.posix.join(dir.replace(/\\/g, '/'), entry.name);
        try {
          items.push(await describe(relative));
        } catch { /* raced with a delete */ }
      }
      items.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'folder' ? -1 : 1));
      const crumbs = [];
      let acc = '';
      for (const part of (dir || '').split('/').filter(Boolean)) {
        acc = acc ? `${acc}/${part}` : part;
        crumbs.push({ name: part, path: acc });
      }
      return { dir: dir || '', crumbs, items, share: { path: shareDir, webdav: '/dav/', totalLabel: await this.usageLabel() } };
    },

    async usage() {
      const walk = async (relative) => {
        let total = 0;
        for (const entry of await readdir(resolve(relative), { withFileTypes: true })) {
          if (entry.name.startsWith('.')) continue;
          const child = path.posix.join(relative, entry.name);
          if (entry.isDirectory()) total += await walk(child);
          else total += (await stat(resolve(child))).size;
        }
        return total;
      };
      try { return await walk(''); } catch { return 0; }
    },

    async usageLabel() { return humanBytes(await this.usage()); },

    async read(relative) {
      const absolute = resolve(relative);
      let info;
      try { info = await stat(absolute); } catch { throw notFound('file not found'); }
      if (!info.isFile()) throw badRequest('not a regular file');
      if (info.size > 512 * 1024 * 1024) throw badRequest('file exceeds the 512 MB download limit');
      return { absolute, info, stream: () => createReadStream(absolute), name: path.basename(absolute), mime: mimeFor(absolute), size: info.size };
    },

    async write(relative, buffer) {
      if (!relative) throw badRequest('file name is required');
      const absolute = resolve(relative);
      await mkdir(path.dirname(absolute), { recursive: true });
      await writeFile(absolute, buffer);
      runtime.emit('files.changed', { action: 'write', path: relative, size: buffer.length });
      return describe(relative);
    },

    async mkdir(relative) {
      if (!relative) throw badRequest('directory name is required');
      await mkdir(resolve(relative), { recursive: true });
      runtime.emit('files.changed', { action: 'mkdir', path: relative });
      return describe(relative);
    },

    async remove(relative) {
      if (!relative) throw badRequest('refusing to delete the share root');
      await rm(resolve(relative), { recursive: true, force: false });
      runtime.emit('files.changed', { action: 'delete', path: relative });
      return { ok: true, path: relative };
    },

    /** Copy a dropped file to a "phone" staging area and notify the companion. */
    async pushToDevice(relative, { appPackage, targetDir = '/sdcard/Download' } = {}) {
      const absolute = resolve(relative);
      let info;
      try { info = await stat(absolute); } catch { throw notFound('file not found'); }
      if (!info.isFile()) throw badRequest('only files can be pushed to a device');
      const transfer = {
        id: uid('xfer'), name: path.basename(absolute), bytes: info.size,
        targetDir, appPackage, ts: new Date().toISOString(),
        method: 'adb push', status: 'queued',
      };
      runtime.emit('transfer.queued', transfer);
      // Real implementation shells out to `adb push`; the bridge keeps the
      // contract and reports progress so the UI works identically in demo mode.
      setTimeout(() => {
        transfer.status = 'complete';
        runtime.emit('transfer.complete', transfer);
        runtime.audit('files.pushed', `${transfer.name} → ${targetDir}`, 'files');
      }, 350);
      return transfer;
    },

    /** Simulated pull request from the companion (Android → share directory). */
    async pullFromDevice(name, bytes = 128_000) {
      const relative = path.posix.join('Inbox', name);
      const absolute = resolve(relative);
      await mkdir(path.dirname(absolute), { recursive: true });
      await writeFile(absolute, Buffer.alloc(0));
      runtime.emit('transfer.received', { id: uid('xfer'), name, bytes, path: relative, ts: new Date().toISOString() });
      return describe(relative);
    },
  };
}
