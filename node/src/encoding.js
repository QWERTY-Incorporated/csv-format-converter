/*
 * 文字コードの判定・変換（UTF-8 / Shift_JIS）
 *
 * Shift_JIS のエンコードは標準 API に無いため、TextDecoder('shift_jis') で
 * 全 2 バイトコードをデコードして逆引き表を作る。WHATWG Encoding Standard の
 * Shift_JIS は実質 Windows-31J (CP932) なので、NEC/IBM 拡張文字（髙・﨑・① など）も扱える。
 */
(function (global) {
  'use strict';

  const ENCODINGS = ['utf-8', 'utf-8-bom', 'shift_jis'];

  // Windows-31J で表現できないが、意味の同じ文字に寄せられる Unicode 文字
  const SJIS_COMPAT = {
    0x00a5: [0x5c], // ¥
    0x203e: [0x7e], // ‾
    0x2212: [0x81, 0x7c], // − MINUS SIGN → －
    0x301c: [0x81, 0x60], // 〜 WAVE DASH → ～
    0x2016: [0x81, 0x61], // ‖
    0x2014: [0x81, 0x5c], // — EM DASH → ―
    0x00a2: [0x81, 0x91], // ¢
    0x00a3: [0x81, 0x92], // £
    0x00ac: [0x81, 0xca], // ¬
  };

  let sjisTable = null;

  function buildSjisTable() {
    const decoder = new TextDecoder('shift_jis');
    const table = new Map();
    for (let lead = 0x81; lead <= 0xfc; lead += 1) {
      if (lead >= 0xa0 && lead <= 0xdf) continue;
      // 0xED/0xEE（NEC 選定 IBM 拡張）は 0xFA〜0xFC と重複するため、WHATWG と同じく後者を採用する
      if (lead === 0xed || lead === 0xee) continue;
      // 0xF0〜0xF9 は外字（私用領域）なので対象外
      if (lead >= 0xf0 && lead <= 0xf9) continue;
      for (let trail = 0x40; trail <= 0xfc; trail += 1) {
        if (trail === 0x7f) continue;
        const ch = decoder.decode(Uint8Array.of(lead, trail));
        if (ch.length !== 1 || ch === '�') continue;
        const cp = ch.charCodeAt(0);
        if (!table.has(cp)) table.set(cp, [lead, trail]);
      }
    }
    for (let b = 0xa1; b <= 0xdf; b += 1) table.set(0xff61 + (b - 0xa1), [b]);
    Object.keys(SJIS_COMPAT).forEach((cp) => {
      if (!table.has(Number(cp))) table.set(Number(cp), SJIS_COMPAT[cp]);
    });
    return table;
  }

  function sjisBytesOf(cp) {
    if (cp < 0x80) return [cp];
    if (!sjisTable) sjisTable = buildSjisTable();
    return sjisTable.get(cp) || null;
  }

  /**
   * バイト列の文字コードを推定する（BOM 付き UTF-8 / UTF-8 / Shift_JIS）。
   * @param {Uint8Array} bytes
   * @returns {'utf-8' | 'utf-8-bom' | 'shift_jis'}
   */
  function detect(bytes) {
    if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
      return 'utf-8-bom';
    }
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      return 'utf-8';
    } catch (_) {
      return 'shift_jis';
    }
  }

  /**
   * バイト列を文字列にデコードする。
   * @param {Uint8Array} bytes
   * @param {'auto' | 'utf-8' | 'utf-8-bom' | 'shift_jis'} [encoding]
   * @returns {{ text: string, encoding: string }}
   */
  function decode(bytes, encoding) {
    const enc = !encoding || encoding === 'auto' ? detect(bytes) : encoding;
    if (!ENCODINGS.includes(enc)) throw new Error(`未対応の文字コードです: ${enc}`);
    const label = enc === 'shift_jis' ? 'shift_jis' : 'utf-8';
    // TextDecoder('utf-8') は既定で BOM を取り除く
    const text = new TextDecoder(label).decode(bytes);
    return { text, encoding: enc };
  }

  /**
   * 指定の文字コードで表現できない文字を返す（重複なし）。
   * @param {string} text
   * @param {string} encoding
   * @returns {string[]}
   */
  function findUnmappable(text, encoding) {
    if (encoding !== 'shift_jis') return [];
    const found = new Set();
    for (const ch of text) {
      const cp = ch.codePointAt(0);
      if (cp > 0xffff || !sjisBytesOf(cp)) found.add(ch);
    }
    return [...found];
  }

  /**
   * 文字列をバイト列にエンコードする。
   * Shift_JIS で表現できない文字は replacement（既定 '?'）に置き換える。
   * 置き換えを許さない場合は事前に findUnmappable で確認すること。
   * @param {string} text
   * @param {'utf-8' | 'utf-8-bom' | 'shift_jis'} encoding
   * @param {{ replacement?: string }} [options]
   * @returns {Uint8Array}
   */
  function encode(text, encoding, options) {
    if (!ENCODINGS.includes(encoding)) throw new Error(`未対応の文字コードです: ${encoding}`);
    if (encoding === 'utf-8') return new TextEncoder().encode(text);
    if (encoding === 'utf-8-bom') return new TextEncoder().encode('﻿' + text);

    const replacement = (options && options.replacement) || '?';
    const out = [];
    for (const ch of text) {
      const cp = ch.codePointAt(0);
      const bytes = cp <= 0xffff ? sjisBytesOf(cp) : null;
      if (bytes) out.push(...bytes);
      else for (const r of replacement) out.push(...(sjisBytesOf(r.charCodeAt(0)) || [0x3f]));
    }
    return Uint8Array.from(out);
  }

  const api = { ENCODINGS, detect, decode, encode, findUnmappable };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else (global.CsvConverter = global.CsvConverter || {}).encoding = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
