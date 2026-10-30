/*
 * 値の変換処理（全角化・半角化・日付整形など）
 *
 * 変換定義では次のいずれかの形で指定する。
 *   "trim"                          … 引数なし
 *   { "zeroPad": 6 }                … 引数あり
 *   { "replace": { "pattern": "-", "with": "" } }
 */
(function (global) {
  'use strict';

  // 半角カナ → 全角カナ の対応表（NFKC から生成）と、その逆引き
  const HALF_KANA_START = 0xff61;
  const HALF_KANA_END = 0xff9f;
  const fullToHalfKana = new Map();
  for (let cp = HALF_KANA_START; cp <= HALF_KANA_END; cp += 1) {
    const half = String.fromCharCode(cp);
    fullToHalfKana.set(half.normalize('NFKC'), half);
  }
  // 単独の濁点・半濁点（゛゜）も半角に寄せる
  fullToHalfKana.set('゛', 'ﾞ');
  fullToHalfKana.set('゜', 'ﾟ');

  /** 半角英数記号・半角カナ・半角スペースを全角にする（Excel の DBCS 関数相当） */
  function fullwidth(value) {
    return String(value)
      .replace(/[｡-ﾟ]+/g, (s) =>
        s.normalize('NFKC').replace(/゙/g, '゛').replace(/゚/g, '゜')
      )
      .replace(/[\x21-\x7e]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0xfee0))
      .replace(/ /g, '　');
  }

  /** 全角英数記号・全角カナ・全角スペースを半角にする（Excel の ASC 関数相当） */
  function halfwidth(value) {
    let out = '';
    for (const ch of String(value)) {
      const cp = ch.codePointAt(0);
      if (cp >= 0xff01 && cp <= 0xff5e) {
        out += String.fromCharCode(cp - 0xfee0);
      } else if (cp === 0x3000) {
        out += ' ';
      } else if (fullToHalfKana.has(ch)) {
        out += fullToHalfKana.get(ch);
      } else if (cp >= 0x30a1 && cp <= 0x30f6) {
        // 濁音・半濁音（ガ・パ など）は基底文字＋濁点に分解して変換する
        const [base, mark] = ch.normalize('NFD');
        out += fullToHalfKana.has(base) && mark && fullToHalfKana.has(mark)
          ? fullToHalfKana.get(base) + fullToHalfKana.get(mark)
          : ch;
      } else {
        out += ch;
      }
    }
    return out;
  }

  /** ひらがなをカタカナにする */
  function katakana(value) {
    return String(value).replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));
  }

  /**
   * 日付文字列を指定の書式にする。解釈できない値はそのまま返す。
   * 入力: 2024/4/1, 2024-04-01, 20240401, 2024年4月1日
   * 書式: YYYY, MM, DD, M, D（例: "YYYYMMDD", "YYYY/MM/DD"）
   */
  function date(value, format) {
    const s = String(value).trim();
    if (s === '') return s;
    let m = s.match(/^(\d{4})[\/\-.年](\d{1,2})[\/\-.月](\d{1,2})日?(?:[ T].*)?$/);
    if (!m) m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (!m) return s;
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const dt = new Date(Date.UTC(y, mo - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return s;
    const pad = (n) => String(n).padStart(2, '0');
    return String(format || 'YYYYMMDD').replace(/YYYY|MM|DD|M|D/g, (t) =>
      ({ YYYY: String(y), MM: pad(mo), DD: pad(d), M: String(mo), D: String(d) })[t]
    );
  }

  const TRANSFORMS = {
    trim: (v) => String(v).trim(),
    upper: (v) => String(v).toUpperCase(),
    lower: (v) => String(v).toLowerCase(),
    fullwidth,
    halfwidth,
    katakana,
    digits: (v) => String(v).replace(/[^0-9]/g, ''),
    zeroPad: (v, width) => {
      const s = String(v);
      return s === '' ? s : s.padStart(Number(width), '0');
    },
    date,
    replace: (v, arg) => String(v).replace(new RegExp(arg.pattern, arg.flags || 'g'), arg.with || ''),
  };

  // 引数が必須の変換
  const REQUIRES_ARG = new Set(['zeroPad', 'replace']);

  /** 変換指定を { name, arg } に正規化する。不正な場合は例外を投げる。 */
  function normalize(spec) {
    if (typeof spec === 'string') {
      if (!TRANSFORMS[spec]) throw new Error(`未知の変換です: ${spec}`);
      if (REQUIRES_ARG.has(spec)) throw new Error(`変換 ${spec} には引数が必要です`);
      return { name: spec, arg: undefined };
    }
    if (spec && typeof spec === 'object' && Object.keys(spec).length === 1) {
      const name = Object.keys(spec)[0];
      if (!TRANSFORMS[name]) throw new Error(`未知の変換です: ${name}`);
      const arg = spec[name];
      if (name === 'replace') {
        if (!arg || typeof arg.pattern !== 'string') throw new Error('replace には pattern が必要です');
        new RegExp(arg.pattern, arg.flags || 'g');
      }
      if (name === 'zeroPad' && !(Number(arg) > 0)) throw new Error('zeroPad には 1 以上の桁数が必要です');
      return { name, arg };
    }
    throw new Error(`変換の指定が不正です: ${JSON.stringify(spec)}`);
  }

  /** 変換を順番に適用する */
  function apply(value, specs) {
    const list = specs == null ? [] : Array.isArray(specs) ? specs : [specs];
    return list.reduce((v, spec) => {
      const { name, arg } = normalize(spec);
      return TRANSFORMS[name](v, arg);
    }, value == null ? '' : String(value));
  }

  const api = { TRANSFORMS, normalize, apply, fullwidth, halfwidth, katakana, date };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else (global.CsvConverter = global.CsvConverter || {}).transforms = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
