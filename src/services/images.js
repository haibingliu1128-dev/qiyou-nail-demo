'use strict';
// 图片服务：校验（魔数判断真实格式，不信任 Content-Type）、大小限制、入库、按 ID 读取。
// 存储走 repo（当前为 SQLite BLOB）；换腾讯云 COS / 阿里云 OSS 时只改 repo 的 putImage/getImage。
const crypto = require('crypto');
const { AppError } = require('../lib/util');
const MAX_BYTES = 2 * 1024 * 1024;   // 压缩后上限（前端会压到约 1080px / JPEG 0.8，一般 100–300KB）
function sniff(b) {
  if (!Buffer.isBuffer(b) || b.length < 12) return null;
  if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return 'image/jpeg';
  if (b.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]))) return 'image/png';
  if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}
const url = id => '/api/images/' + id;
function createImageService({ repo }) {
  function save(buf, owner, { seed } = {}) {
    if (!Buffer.isBuffer(buf) || !buf.length) throw new AppError(400, 'IMAGE_EMPTY', '没有收到图片');
    if (buf.length > MAX_BYTES) throw new AppError(413, 'IMAGE_TOO_LARGE', `图片太大：压缩后需小于 ${MAX_BYTES / 1024 / 1024}MB`);
    const mime = sniff(buf);
    if (!mime) throw new AppError(415, 'IMAGE_BAD_TYPE', '仅支持 JPG / PNG / WebP 图片');
    const id = seed ? 'demo' + crypto.createHash('sha1').update(buf).digest('hex').slice(0, 20) : crypto.randomBytes(12).toString('base64url');
    if (!(seed && repo.getImage(id))) repo.putImage({ id, mime, data: buf, owner_type: owner ? owner.type : null, owner_id: owner ? owner.id : null, seed: seed ? 1 : 0 });
    return { id, url: url(id), mime, bytes: buf.length };
  }
  /** 校验一组图片 ID（必须真实存在），返回去重后的数组 */
  function checkIds(ids, max, label) {
    if (ids == null) return [];
    if (!Array.isArray(ids)) throw new AppError(400, 'BAD_INPUT', `${label || '图片'}格式不正确`);
    const u = [...new Set(ids.map(String))];
    if (u.length > max) throw new AppError(400, 'TOO_MANY_IMAGES', `${label || '图片'}最多 ${max} 张`);
    const found = new Set(repo.imageMeta(u).map(r => r.id));
    if (u.some(id => !found.has(id))) throw new AppError(400, 'IMAGE_NOT_FOUND', '图片不存在或已过期，请重新上传');
    return u;
  }
  const parse = j => { try { const a = JSON.parse(j || '[]'); return Array.isArray(a) ? a : []; } catch { return []; } };
  return { save, checkIds, parse, url, sniff, MAX_BYTES };
}
module.exports = { createImageService, sniff, MAX_BYTES };
