/*
 * 変換エンジン本体
 *
 * 入力 CSV の各行を、出力テンプレート（ヘッダー行）と変換定義（mapping）に従って
 * 出力 CSV の行に組み替える。除外条件に該当した行は理由付きで別に返す。
 * 変換定義の仕様は docs/mapping-spec.md を参照。
 */
(function (global) {
  'use strict';

  const transforms =
    typeof require === 'function' ? require('./transforms') : global.CsvConverter.transforms;

  const OPS = {
    eq: (v, x) => v === String(x),
    ne: (v, x) => v !== String(x),
    in: (v, x) => x.map(String).includes(v),
    notIn: (v, x) => !x.map(String).includes(v),
    empty: (v) => v === '',
    notEmpty: (v) => v !== '',
    regex: (v, x) => new RegExp(x).test(v),
  };

  const SPEC_KINDS = ['from', 'value', 'concat', 'sequence'];

  function normalizeHeader(h) {
    return String(h == null ? '' : h).replace(/^﻿/, '').trim();
  }

  /** 列指定を正規化する（文字列の省略形は { from } とみなす） */
  function normalizeColumnSpec(spec) {
    if (typeof spec === 'string') return { from: spec };
    return spec || {};
  }

  function conditionColumns(rule) {
    if (Array.isArray(rule.all)) return rule.all.flatMap(conditionColumns);
    if (Array.isArray(rule.any)) return rule.any.flatMap(conditionColumns);
    return [rule.column];
  }

  /**
   * 変換定義を検証し、エラーメッセージの配列を返す（空なら問題なし）。
   * @param {object} mapping
   * @param {string[]} inputHeaders
   * @param {string[]} outputHeaders
   */
  function validate(mapping, inputHeaders, outputHeaders) {
    const errors = [];
    const m = mapping || {};
    const has = (col) => inputHeaders.includes(col);
    const missing = (col, where) => {
      if (!has(col)) errors.push(`${where}: 入力 CSV に列「${col}」がありません`);
    };

    const columns = m.columns || {};
    Object.keys(columns).forEach((out) => {
      const where = `columns.${out}`;
      if (!outputHeaders.includes(out)) {
        errors.push(`${where}: 出力テンプレートに列「${out}」がありません`);
      }
      const spec = normalizeColumnSpec(columns[out]);
      const kinds = SPEC_KINDS.filter((k) => k in spec);
      if (kinds.length !== 1) {
        errors.push(`${where}: from / value / concat / sequence のいずれか 1 つを指定してください`);
        return;
      }
      if ('from' in spec) missing(spec.from, where);
      if ('concat' in spec) {
        if (!Array.isArray(spec.concat)) errors.push(`${where}: concat は配列で指定してください`);
        else spec.concat.forEach((p) => typeof p === 'string' && missing(p, where));
      }
      if ('sequence' in spec && spec.sequence && spec.sequence.groupBy) {
        missing(spec.sequence.groupBy, where);
      }
      if ('transform' in spec) {
        const list = Array.isArray(spec.transform) ? spec.transform : [spec.transform];
        list.forEach((t) => {
          try {
            transforms.normalize(t);
          } catch (e) {
            errors.push(`${where}: ${e.message}`);
          }
        });
      }
      if ('map' in spec && (typeof spec.map !== 'object' || Array.isArray(spec.map))) {
        errors.push(`${where}: map はオブジェクトで指定してください`);
      }
    });

    (m.exclude || []).forEach((rule, i) => {
      const where = `exclude[${i}]`;
      conditionColumns(rule).forEach((c) => missing(c, where));
      const check = (cond) => {
        if (Array.isArray(cond.all)) return cond.all.forEach(check);
        if (Array.isArray(cond.any)) return cond.any.forEach(check);
        if (!OPS[cond.op]) errors.push(`${where}: 未知の演算子です: ${cond.op}`);
        if ((cond.op === 'in' || cond.op === 'notIn') && !Array.isArray(cond.value)) {
          errors.push(`${where}: ${cond.op} の value は配列で指定してください`);
        }
      };
      check(rule);
    });
    return errors;
  }

  function evaluate(cond, record) {
    if (Array.isArray(cond.all)) return cond.all.every((c) => evaluate(c, record));
    if (Array.isArray(cond.any)) return cond.any.some((c) => evaluate(c, record));
    const v = String(record[cond.column] == null ? '' : record[cond.column]).trim();
    return OPS[cond.op](v, cond.value);
  }

  function describeRule(rule) {
    if (rule.reason) return rule.reason;
    if (Array.isArray(rule.all) || Array.isArray(rule.any)) return '除外条件に該当';
    return `${rule.column} ${rule.op} ${rule.value == null ? '' : JSON.stringify(rule.value)}`.trim();
  }

  /**
   * 変換を実行する。
   * @param {{ inputRows: string[][], outputHeaders: string[], mapping?: object }} params
   *   inputRows は 1 行目がヘッダーの 2 次元配列
   * @returns {{
   *   headers: string[], rows: string[][],
   *   excluded: { headers: string[], rows: string[][] },
   *   warnings: string[], stats: { input: number, output: number, excluded: number }
   * }}
   */
  function convert(params) {
    const mapping = params.mapping || {};
    const [rawHeaders = [], ...dataRows] = params.inputRows;
    const inputHeaders = rawHeaders.map(normalizeHeader);
    const outputHeaders = params.outputHeaders.map(normalizeHeader);

    if (outputHeaders.length === 0 || outputHeaders.every((h) => h === '')) {
      throw new Error('出力テンプレートのヘッダー行が空です');
    }
    const errors = validate(mapping, inputHeaders, outputHeaders);
    if (errors.length > 0) {
      const err = new Error(`変換定義にエラーがあります:\n- ${errors.join('\n- ')}`);
      err.details = errors;
      throw err;
    }

    const warnings = [];
    const columns = mapping.columns || {};
    const autoMap = mapping.autoMapSameName !== false;
    const specs = outputHeaders.map((h) => {
      if (h in columns) return normalizeColumnSpec(columns[h]);
      if (autoMap && inputHeaders.includes(h)) return { from: h };
      if (h !== '') warnings.push(`出力列「${h}」に対応する入力がないため空欄で出力します`);
      return { value: '' };
    });

    const records = dataRows.map((cells, i) => {
      const record = {};
      inputHeaders.forEach((h, c) => {
        if (h !== '' && !(h in record)) record[h] = cells[c] == null ? '' : cells[c];
      });
      return { line: i + 2, cells, record };
    });

    const excludedRows = [];
    const included = [];
    records.forEach((r) => {
      const rule = (mapping.exclude || []).find((x) => evaluate(x, r.record));
      if (!rule) {
        included.push(r);
        return;
      }
      const original = inputHeaders.map((_, c) => (r.cells[c] == null ? '' : r.cells[c]));
      excludedRows.push([String(r.line), describeRule(rule), ...original]);
    });

    const counters = specs.map(() => new Map());
    const rows = included.map(({ record }) =>
      specs.map((spec, c) => {
        let value;
        if ('from' in spec) {
          value = record[spec.from];
        } else if ('concat' in spec) {
          value = spec.concat
            .map((p) => (typeof p === 'string' ? record[p] : p && 'value' in p ? p.value : ''))
            .join(spec.separator == null ? '' : spec.separator);
        } else if ('sequence' in spec) {
          const seq = spec.sequence || {};
          const key = seq.groupBy ? String(record[seq.groupBy]) : '';
          const start = seq.start == null ? 1 : Number(seq.start);
          const next = counters[c].has(key) ? counters[c].get(key) + 1 : start;
          counters[c].set(key, next);
          value = String(next);
        } else {
          value = spec.value;
        }

        value = transforms.apply(value, spec.transform);
        if (spec.map) {
          if (Object.prototype.hasOwnProperty.call(spec.map, value)) value = spec.map[value];
          else if ('*' in spec.map) value = spec.map['*'];
        }
        if (value === '' && spec.default != null) value = spec.default;
        return value == null ? '' : String(value);
      })
    );

    return {
      headers: outputHeaders,
      rows,
      excluded: { headers: ['行番号', '除外理由', ...inputHeaders], rows: excludedRows },
      warnings,
      stats: { input: records.length, output: rows.length, excluded: excludedRows.length },
    };
  }

  const api = { OPS, validate, convert, normalizeColumnSpec };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else (global.CsvConverter = global.CsvConverter || {}).converter = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
