/*
 * CSV の読み書き（RFC 4180 準拠・依存ライブラリなし）
 * Node.js（CommonJS）とブラウザ（<script> 読み込み）の両方で動作する。
 */
(function (global) {
  'use strict';

  /**
   * CSV 文字列を 2 次元配列に変換する。
   * @param {string} text
   * @param {{ delimiter?: string, skipEmptyLines?: boolean }} [options]
   * @returns {string[][]}
   */
  function parse(text, options) {
    const opts = Object.assign({ delimiter: ',', skipEmptyLines: true }, options);
    const d = opts.delimiter;
    const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;
    let fieldStarted = false;

    const endField = () => {
      row.push(field);
      field = '';
      fieldStarted = false;
    };
    const endRow = () => {
      endField();
      const isEmpty = row.length === 1 && row[0] === '';
      if (!(opts.skipEmptyLines && isEmpty)) rows.push(row);
      row = [];
    };

    for (let i = 0; i < src.length; i += 1) {
      const ch = src[i];
      if (inQuotes) {
        if (ch === '"') {
          if (src[i + 1] === '"') {
            field += '"';
            i += 1;
          } else {
            inQuotes = false;
          }
        } else {
          field += ch;
        }
        continue;
      }
      if (ch === '"' && !fieldStarted) {
        inQuotes = true;
        fieldStarted = true;
      } else if (ch === d) {
        endField();
      } else if (ch === '\r' || ch === '\n') {
        if (ch === '\r' && src[i + 1] === '\n') i += 1;
        endRow();
      } else {
        field += ch;
        fieldStarted = true;
      }
    }
    if (inQuotes) {
      throw new Error('CSV の解析に失敗しました: 閉じられていないダブルクォートがあります');
    }
    if (field !== '' || row.length > 0) endRow();
    return rows;
  }

  /**
   * 2 次元配列を CSV 文字列に変換する。
   * @param {Array<Array<unknown>>} rows
   * @param {{ delimiter?: string, newline?: string, quote?: 'auto' | 'all' }} [options]
   * @returns {string}
   */
  function stringify(rows, options) {
    const opts = Object.assign({ delimiter: ',', newline: '\r\n', quote: 'auto' }, options);
    const needsQuote = (s) =>
      s.includes(opts.delimiter) || s.includes('"') || s.includes('\r') || s.includes('\n');
    const lines = rows.map((row) =>
      row
        .map((value) => {
          const s = value == null ? '' : String(value);
          if (opts.quote === 'all' || needsQuote(s)) return `"${s.replace(/"/g, '""')}"`;
          return s;
        })
        .join(opts.delimiter)
    );
    return lines.join(opts.newline) + (lines.length > 0 ? opts.newline : '');
  }

  const api = { parse, stringify };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else (global.CsvConverter = global.CsvConverter || {}).csv = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
