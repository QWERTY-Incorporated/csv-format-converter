#!/usr/bin/env node
/*
 * コマンドライン版
 *   node bin/csv-convert.js -i input.csv -t template.csv -m mapping.json -o output.csv
 */
'use strict';

const fs = require('fs');
const path = require('path');
const pipeline = require('../src/pipeline');

const USAGE = `使い方:
  node bin/csv-convert.js --input <入力CSV> --template <出力テンプレートCSV> [オプション]

必須:
  -i, --input <file>          変換元の CSV
  -t, --template <file>       出力レイアウトを表す CSV（1 行目のヘッダーのみ使用）

オプション:
  -m, --mapping <file>        変換定義 JSON（省略時は同名の列だけを対応付け）
  -o, --output <file>         出力先（省略時は <入力名>_converted.csv）
      --excluded <file>       除外リストの出力先（省略時は <入力名>_excluded.csv）
      --input-encoding <enc>  auto | utf-8 | utf-8-bom | shift_jis（既定: auto）
      --output-encoding <enc> utf-8 | utf-8-bom | shift_jis（既定: 変換定義の値、無ければ shift_jis）
      --newline <crlf|lf>     出力の改行コード
      --force                 出力先が既にあっても上書きする
  -h, --help                  このヘルプを表示
`;

const OPTIONS = {
  '-i': 'input', '--input': 'input',
  '-t': 'template', '--template': 'template',
  '-m': 'mapping', '--mapping': 'mapping',
  '-o': 'output', '--output': 'output',
  '--excluded': 'excluded',
  '--input-encoding': 'inputEncoding',
  '--output-encoding': 'outputEncoding',
  '--newline': 'newline',
};

function parseArgs(argv) {
  const args = { force: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '-h' || a === '--help') args.help = true;
    else if (a === '--force') args.force = true;
    else if (OPTIONS[a]) {
      if (argv[i + 1] == null) throw new Error(`${a} の値がありません`);
      args[OPTIONS[a]] = argv[i + 1];
      i += 1;
    } else {
      throw new Error(`不明な引数です: ${a}`);
    }
  }
  return args;
}

function defaultPath(inputPath, suffix) {
  const { dir, name } = path.parse(inputPath);
  return path.join(dir, `${name}_${suffix}.csv`);
}

function writeOutput(filePath, bytes, force) {
  if (!force && fs.existsSync(filePath)) {
    throw new Error(`出力先が既に存在します（上書きする場合は --force）: ${filePath}`);
  }
  fs.writeFileSync(filePath, bytes);
}

function main(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(USAGE);
    return 0;
  }
  if (!args.input || !args.template) {
    process.stderr.write(`--input と --template は必須です\n\n${USAGE}`);
    return 2;
  }

  const mapping = args.mapping ? JSON.parse(fs.readFileSync(args.mapping, 'utf8')) : {};
  const output = {};
  if (args.outputEncoding) output.encoding = args.outputEncoding;
  if (args.newline) output.newline = args.newline;

  const result = pipeline.run({
    inputBytes: fs.readFileSync(args.input),
    templateBytes: fs.readFileSync(args.template),
    mapping,
    inputEncoding: args.inputEncoding,
    output,
  });

  const outputPath = args.output || defaultPath(args.input, 'converted');
  writeOutput(outputPath, result.outputBytes, args.force);

  result.warnings.forEach((w) => process.stderr.write(`警告: ${w}\n`));
  const { input, output: outCount, excluded } = result.stats;
  process.stdout.write(`入力 ${input} 件 → 出力 ${outCount} 件（除外 ${excluded} 件）\n`);
  process.stdout.write(`出力: ${outputPath}（${result.output.encoding}）\n`);

  if (result.excludedBytes) {
    const excludedPath = args.excluded || defaultPath(args.input, 'excluded');
    writeOutput(excludedPath, result.excludedBytes, args.force);
    process.stdout.write(`除外リスト: ${excludedPath}\n`);
  }
  return 0;
}

if (require.main === module) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (e) {
    process.stderr.write(`エラー: ${e.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { main, parseArgs };
