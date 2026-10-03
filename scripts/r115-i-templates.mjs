import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import XLSX from 'xlsx';
// This is the ordinary Content Operations CSV/XLSX contract, not the separate
// Article Library Excel contract (which calls its optional columns differently).
const root = resolve('docs/product/r115-i-pilot-preview/templates'); mkdirSync(root, { recursive: true });
const columns = ['标题', '正文', '摘要', '企业', '业务', '城市', '关键词', '标签', '目标平台', '内容类型', '推广强度', '来源说明', '模板版本'];
const company = '合成试用企业';
const rows = [
  ['合成试用流程', '这是离线部门试用的合成资料，不代表真实客户案例。\n第一步：核对企业工作区。\n第二步：人工审阅草稿并保存。', '', company, '', '', '', '合成', '', '', '', '合成示例；来源日期 2026-10-03', '1.0'],
  ['合成长标题用于文章库校验并在选择抖音前人工缩短到二十字符以内', '合成示例第二条，演示较长标题、中文和空可选列。没有认证、客户或业绩声明。', '', company, '', '', '', '', '', '', '', '2026-10-03', '1.0'],
];
const csv = matrix => '\uFEFF' + matrix.map(row => row.map(value => '"' + String(value).replaceAll('"', '""') + '"').join(',')).join('\r\n') + '\r\n';
writeFileSync(join(root, '合成示例.csv'), csv([columns, rows[0]]));
writeFileSync(join(root, '校验问题示例.csv'), csv([columns,
  ['', '合成缺标题，应在预览拦截。', '', company, '', '', '', '', '', '', '', '', '1.0'],
  ['合成企业冲突', '属于另一合成企业，不得混入当前企业。', '', '合成另一企业', '', '', '', '', '', '', '', '', '1.0'],
  ['长'.repeat(201), '合成超长标题，应在预览拦截。', '', company, '', '', '', '', '', '', '', '', '1.0'],
  ['合成缺正文', '', '', company, '', '', '', '', '', '', '', '', '1.0'],
]));
const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([columns, ...rows]), '合成草稿');
XLSX.writeFile(book, join(root, '文章导入模板.xlsx'));
const formulaBook = XLSX.utils.book_new(), formulaSheet = XLSX.utils.aoa_to_sheet([columns,
 ['2', '合成公式检查：只读取文件中的缓存文本，不计算公式、不触发生成或发布。', '', company, '', '', '', '', '', '', '', '合成公式静态检查', '1.0'],
]);
formulaSheet.A2 = { t: 'n', f: '1+1', v: 2 };
XLSX.utils.book_append_sheet(formulaBook, formulaSheet, '缓存值检查'); XLSX.writeFile(formulaBook, join(root, '公式静态检查.xlsx'));
assert.equal(XLSX.readFile(join(root, '文章导入模板.xlsx')).SheetNames[0], '合成草稿');
console.log(JSON.stringify({ status: 'PASS_GENERATED_ONLY_UI_IMPORT_PENDING', columns: columns.length, templateRows: rows.length, publicSyntheticOnly: true }));
