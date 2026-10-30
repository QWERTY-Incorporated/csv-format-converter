/*
 * ファイル（バイト列）単位の変換処理
 * 文字コード判定 → CSV 解析 → 変換 → 文字コードチェック → CSV 出力 をまとめて行う。
 * CLI とブラウザ版の両方からこの関数を呼び出す。
 */
(function (global) {
  'use strict';

  const ns = typeof require === 'function' ? null : global.CsvConverter;
  const csv = ns ? ns.csv : require('./csv');
  const encoding = ns ? ns.encoding : require('./encoding');
  const converter = ns ? ns.converter : require('./converter');

  const NEWLINES = { crlf: '\r\n', lf: '\n' };

  /** 変換定義の output 設定に既定値を補う */
  function resolveOutputOptions(mapping, overrides) {
    const o = Object.assign(
      { encoding: 'shift_jis', newline: 'crlf', quote: 'auto', onUnmappable: 'error' },
      (mapping && mapping.output) || {},
      overrides || {}
    );
    if (!encoding.ENCODINGS.includes(o.encoding)) throw new Error(`未対応の出力文字コードです: ${o.encoding}`);
    if (!NEWLINES[o.newline]) throw new Error(`未対応の改行コードです: ${o.newline}`);
    if (!['auto', 'all'].includes(o.quote)) throw new Error(`quote は auto か all を指定してください: ${o.quote}`);
    if (!['error', 'replace'].includes(o.onUnmappable)) {
      throw new Error(`onUnmappable は error か replace を指定してください: ${o.onUnmappable}`);
    }
    return o;
  }

  /** テンプレート CSV の 1 行目（ヘッダー）を取り出す */
  function readTemplateHeaders(templateBytes, templateEncoding) {
    const { text } = encoding.decode(templateBytes, templateEncoding);
    const rows = csv.parse(text);
    if (rows.length === 0) throw new Error('出力テンプレート CSV が空です');
    return rows[0];
  }

  /** 出力文字コードで表現できない文字の位置を列挙する */
  function checkUnmappable(headers, rows, enc) {
    const problems = [];
    rows.forEach((row, r) => {
      row.forEach((cell, c) => {
        const chars = encoding.findUnmappable(cell, enc);
        if (chars.length > 0) {
          problems.push(`出力 ${r + 1} 行目「${headers[c]}」: ${chars.join(' ')}`);
        }
      });
    });
    return problems;
  }

  /**
   * @param {{
   *   inputBytes: Uint8Array, templateBytes: Uint8Array, mapping?: object,
   *   inputEncoding?: string, templateEncoding?: string, output?: object
   * }} params
   */
  function run(params) {
    const mapping = params.mapping || {};
    const input = mapping.input || {};
    const out = resolveOutputOptions(mapping, params.output);

    const decoded = encoding.decode(params.inputBytes, params.inputEncoding || input.encoding || 'auto');
    const inputRows = csv.parse(decoded.text, { delimiter: input.delimiter || ',' });
    if (inputRows.length === 0) throw new Error('入力 CSV が空です');

    const outputHeaders = readTemplateHeaders(
      params.templateBytes,
      params.templateEncoding || 'auto'
    );
    const result = converter.convert({ inputRows, outputHeaders, mapping });

    const warnings = [...result.warnings];
    const problems = checkUnmappable(result.headers, result.rows, out.encoding);
    if (problems.length > 0) {
      const message = `${out.encoding} で表現できない文字があります（${problems.length} 箇所）`;
      if (out.onUnmappable === 'error') {
        const err = new Error(`${message}:\n- ${problems.slice(0, 20).join('\n- ')}`);
        err.details = problems;
        throw err;
      }
      warnings.push(`${message}。「?」に置き換えました`, ...problems.slice(0, 20));
    }

    const stringifyOpts = { newline: NEWLINES[out.newline], quote: out.quote };
    const outputText = csv.stringify([result.headers, ...result.rows], stringifyOpts);
    // 除外リストは元データの文字を落とさないよう、Excel で開ける BOM 付き UTF-8 で出力する
    const excludedText = csv.stringify([result.excluded.headers, ...result.excluded.rows], stringifyOpts);

    return {
      outputBytes: encoding.encode(outputText, out.encoding),
      excludedBytes: result.excluded.rows.length > 0 ? encoding.encode(excludedText, 'utf-8-bom') : null,
      headers: result.headers,
      rows: result.rows,
      excluded: result.excluded,
      inputHeaders: inputRows[0],
      inputEncoding: decoded.encoding,
      output: out,
      warnings,
      stats: result.stats,
    };
  }

  const api = { run, readTemplateHeaders, resolveOutputOptions };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else (global.CsvConverter = global.CsvConverter || {}).pipeline = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
