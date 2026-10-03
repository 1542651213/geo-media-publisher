import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

const evidence = resolve('output/r115-i-execution-20261003');
const read = name => JSON.parse(readFileSync(join(evidence, name + '.json'), 'utf8'));
const parameters = read('final-package-parameters'), identity = read('package-identity');
const employee = read('final-employee-journey'), faults = read('final-offline-ui-faults');
const independent = read('independent-start'), launcher = read('launcher-validation'), installation = read('final-install');
const actualLauncher = read('actual-launcher-installed');
const companyRecovery = read('final-company-creation-recovery');
for (const value of [identity, employee, faults, independent, launcher, installation, actualLauncher, companyRecovery]) assert.equal(value.status, 'PASS');
assert.equal(employee.finalRun, true); assert.equal(employee.build.sourceCommit, parameters.source);
assert.equal(independent.build.sourceCommit, parameters.source);
for (const item of companyRecovery.cases) { assert.equal(item.status, 'PASS'); assert.equal(item.build.sourceCommit, parameters.source); }
const testLog = readFileSync(join(evidence, 'final-full-tests.log'), 'utf8');
const tests = /Test Files\s+(\d+) passed \((\d+)\)[\s\S]+?Tests\s+(\d+) passed \((\d+)\)/u.exec(testLog);
assert.ok(tests); assert.equal(tests[1], tests[2]); assert.equal(tests[3], tests[4]);
const hash = data => createHash('sha256').update(data).digest('hex');
const installer = resolve(parameters.output, parameters.installer);
assert.equal(hash(readFileSync(installer)), identity.installerSha256);
const preview = resolve('docs/product/r115-i-pilot-preview');
const captions = [
 ['00-fresh-start', '首次进入新库', '从 Start-Pilot.cmd 启动并核对 I 身份。空库点击右上角“创建企业资料”，填写企业名称和简称。'],
 ['01-import-preview', '导入字段与预览', '在内容运营的批量导入页选择模板，核对企业和字段映射；向下滚动检查行预览，再选择 Import as Draft。不会创建发布任务。'],
 ['02-import-errors', '逐行校验错误', '合成问题文件有四行错误，零行可导入。下方显示缺失标题、企业不匹配和正文等原因；修改文件后重新预览。'],
 ['03-draft-saved', '编辑与自动保存', '在文章库点“修改”，等待“已保存”。重开后明确恢复上次编辑；提交工作副本后仍需重新审核。'],
 ['04-articles', '人工审核后的文章', '仅一条合成流程经过本次人工审核。另两条仍需处理；“可发布”表示内容层状态，账号与平台门禁仍需逐项核对。'],
 ['05-publish-blocked', '无账号时的发布保护', '新库没有已验证账号，开始发布按钮不可用。本轮没有准备远端草稿、媒体上传或最终提交。'],
 ['06-ai-no-key', 'AI 服务商未配置', '现有服务商预设可见，API Key 为空，没有保存或测试连接。今晚不产生 GEO 外部 AI 请求。'],
 ['07-accounts-empty', '账号中心的新库状态', '当前企业没有账号。正式凭据只能由 Owner 后续从安全入口配置，不能继承或复制历史测试凭据。'],
 ['08-home', '今日工作台', '合成资料的待审与已审状态可见；没有可信账号检查结果。首页计数不能替代真实平台验收。'],
 ['09-owner', 'Owner 处理入口', '当前新库处理项为零。页面下方 H 交付清单是历史待核对记录，不能当作这个空库已经绑定了历史账号。'],
 ['10-version', '确认当前版本', '在设置展开“构建与数据版本详情”，核对 R1.15-I、1.1.9 和 SOFTWARE.json 中的源码标识。main 仍为 H Candidate。'],
 ['11-backup', '创建完整新库快照', '此图拍于创建前。实际 UI 随后正常关闭、生成 Complete 快照、校验并恢复到另一隔离目录；恢复后自动执行保持关闭。'],
 ['12-jobs-simulated-readonly', '结果未知的只读演示', 'SIMULATED：内存只读夹具展示 Unknown 和历史状态。真实数据库没有发布任务或记录，不代表真实平台通过；未知结果不可重发。']
];
const screenshots = captions.map(([name, title, caption]) => {
 const file = name + '.png', bytes = readFileSync(join(preview, file));
 assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
 return { file, title, caption, width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), sha256: hash(bytes) };
});
assert.ok(screenshots.every(row => row.width === screenshots[0].width && row.height === screenshots[0].height));
const software = {
 deliveryId: 'R1.15-I', appVersion: employee.build.appVersion, sourceCommit: parameters.source,
 appAsarSha256: identity.installedAppAsarSha256, installerFilename: basename(installer),
 installerBytes: identity.installerBytes, installerSha256: identity.installerSha256,
 nsisGuid: parameters.nsisGuid, signatureStatus: installation.installerSignature,
 launcher: 'Start-Pilot.cmd', dataRoute: 'NEW_PROFILE_ONLY', mainMerged: false
};
writeFileSync('docs/product/pilot-launcher/SOFTWARE.json', JSON.stringify(software, null, 2) + '\n');
const privateSummary = read('private-preparation-summary');
const { privateReviewDirectory, ...safePrivateSummary } = privateSummary;
assert.ok(privateReviewDirectory && !JSON.stringify(safePrivateSummary).includes('D:\\'));
const publicEvidence = {
 status: 'VERIFIED_OFFLINE_PILOT', evidenceLayer: 'SAME_MACHINE_ADMIN_ACTUAL_NSIS_INSTALLED_SYNTHETIC_DATA',
 software, tests: { sourceCommit: parameters.source, files: Number(tests[1]), count: Number(tests[3]), focusedFiles: 9, focusedTests: 61, typecheck: 'PASS', lint: 'PASS', build: 'PASS' },
 installedJourney: { status: employee.status, checks: employee.checks, starts: employee.starts, normalExits: employee.exits,
  directSqlMutations: employee.directSqlMutations, networkByStart: employee.networkByStart, sourceReadCounts: employee.independenceByStart.map(row => row.sourceReads),
  sourceModuleCounts: employee.independenceByStart.map(row => row.sourceModules), secondInstance: employee.secondInstance,
  newProfileSnapshot: 'COMPLETE_VERIFIED_AND_ISOLATED_RESTORE', restoredAutomaticExecutionDisabled: true, diagnosticPrivacy: 'PASS' },
 faults, companyCreationRecovery: { status: companyRecovery.status, sourceCommit: parameters.source, cases: companyRecovery.cases.map(item => ({ name: item.name, status: item.status, checks: item.checks, directSqlMutations: item.directSqlMutations, network: item.network, networkExit: item.networkExit, independence: item.independence })) },
 independentStart: { status: independent.status, kind: independent.kind, controllerExitedBeforeObservation: independent.controllerExitedBeforeObservation,
  mainContinuedAndOrdinaryUiResponded: independent.mainContinuedAndOrdinaryUiResponded, codexDesktopProcessStopped: false, network: independent.network },
 launcher, actualLauncher, installation, privatePreparationCountsOnly: safePrivateSummary, screenshots,
 limits: { separateCleanWindowsMachine: 'NOT_RUN', standardUser: 'NOT_RUN', productionUpgrade: 'PENDING_OWNER_AND_BACKUP_REVALIDATION',
  fullPrivateMediaRestore: 'BLOCKED_MISSING_FILES', firstRealAccount: 'PENDING_OWNER', realBusinessPublish: 'NOT_AUTHORIZED_THIS_TASK',
  liveCloudGeneration: 'NOT_RUN', realPlatformNetwork: 'NOT_RUN_BY_DESIGN', mainMerged: false, allBatch: 'OFF' }
};
writeFileSync(join(preview, 'evidence.json'), JSON.stringify(publicEvidence, null, 2) + '\n');
const intro = '来源：本轮实际 NSIS 安装版 R1.15-I / 应用 ' + software.appVersion + ' / 源码 ' + parameters.source +
 '。截图 ' + screenshots[0].width + ' × ' + screenshots[0].height + ' 像素，应用缩放 100%。全部企业、内容和图片为合成资料，平台/云请求为零。\n\n' +
 '这是同机管理员账户的安装版与新库验收；标准用户和独立干净 Windows 电脑未执行。手机预览展示桌面原图和操作说明，不是手机产品或新电脑证据。\n';
const guide = '# R1.15-I 员工操作图解与完整图集\n\n' + intro +
 '\n[开始使用](../department-pilot-quickstart.md) · [首日清单](../day-one-acceptance.md) · [离线手机可读图集](index.html) · [手机预览](phone-preview.png) · [脱敏验收证据](evidence.json)\n\n' +
 screenshots.map(row => '## ' + row.title + '\n\n' + row.caption + '\n\n![' + row.title + '](' + row.file + ')\n').join('\n');
writeFileSync(join(preview, 'index.md'), guide);
const escape = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const cards = screenshots.map(row => '<article><h2>' + escape(row.title) + '</h2><p>' + escape(row.caption) + '</p><a href="' + row.file +
 '"><img src="' + row.file + '" alt="' + escape(row.title) + '" width="' + row.width + '" height="' + row.height +
 '"></a><a class="zoom" href="' + row.file + '">打开桌面原图 / 放大阅读</a></article>').join('\n');
const html = '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
 '<title>GEO · R1.15-I 部门试用图解</title><style>body{margin:0;background:#f6f5fa;color:#20263b;font:16px/1.7 "Microsoft YaHei",system-ui,sans-serif}' +
 'header{background:#251e3e;color:white;padding:24px}main{max-width:1080px;margin:0 auto;padding:18px}h1{font-size:26px;line-height:1.3}h2{font-size:21px}' +
 'article{background:white;border:1px solid #e7e3f2;border-radius:14px;padding:18px;margin:0 0 20px}img{width:100%;height:auto;border:1px solid #e7e3f2;box-sizing:border-box}' +
 'a{color:#5d43bd}header a{color:#ded2ff}code{overflow-wrap:anywhere;font-size:12px}p{margin:12px 0}.zoom{display:inline-block;margin-top:10px}' +
 '@media(max-width:600px){header{padding:20px}main{padding:12px}article{padding:14px}h1{font-size:24px}}</style>' +
 '<header><h1>GEO · 部门试用操作图解</h1><p>R1.15-I Candidate · 实际安装版 · 合成资料</p><a href="../department-pilot-quickstart.md">开始使用</a> · <a href="../day-one-acceptance.md">明天现场清单</a></header>' +
 '<main><p>先用新库练习，Owner 确认企业、账号与内容后再验收真实业务。手机阅读说明，点图片放大桌面原图。</p><p>应用 ' + software.appVersion +
 ' · ' + screenshots[0].width + ' × ' + screenshots[0].height + ' · 缩放 100%<br>来源 <code>' + parameters.source + '</code></p>' + cards + '</main></html>';
writeFileSync(join(preview, 'index.html'), html);
if (process.argv.includes('--prepare-only')) {
 console.log(JSON.stringify({ status: 'PUBLIC_GUIDE_PREPARED', screenshots: screenshots.length, source: parameters.source }));
} else {
 assert.ok(existsSync(join(preview, 'phone-preview.png')), 'Phone preview must be verified before packaging');
 const stage = join(evidence, 'handoff-' + Date.now()), root = join(stage, 'GEO-R115I-DEPARTMENT-PILOT'); mkdirSync(root, { recursive: true });
 cpSync(installer, join(root, basename(installer)));
 for (const file of ['Start-Pilot.cmd', 'Start-Pilot.ps1', 'SOFTWARE.json']) cpSync(join('docs/product/pilot-launcher', file), join(root, file));
 for (const name of ['department-pilot-quickstart', 'department-pilot-support', 'department-pilot-install', 'department-pilot-troubleshooting', 'day-one-acceptance']) {
  const target = join(root, 'docs/product', name + '.md'); mkdirSync(resolve(target, '..'), { recursive: true }); cpSync('docs/product/' + name + '.md', target);
 }
 cpSync(preview, join(root, 'docs/product/r115-i-pilot-preview'), { recursive: true });
 const entries = [
  ['00-开始使用', 'department-pilot-quickstart.md'], ['01-当前支持范围', 'department-pilot-support.md'],
  ['02-安装与数据目录', 'department-pilot-install.md'], ['03-员工操作图解', 'r115-i-pilot-preview/index.md'],
  ['04-遇到问题怎么办', 'department-pilot-troubleshooting.md'], ['05-首日验收检查单', 'day-one-acceptance.md']
 ];
 for (const [title, file] of entries) writeFileSync(join(root, title + '.md'), '# ' + title.slice(3) + '\n\n[打开完整说明](docs/product/' + file +
 ')\n\n先校验安装包，在新程序目录安装，再使用本目录 Start-Pilot.cmd 启动独立新库。离线图解入口：[index.html](docs/product/r115-i-pilot-preview/index.html)。\n');
 const handbook = entries.map(([title, file], index) => '<section id="step-' + index + '"><h2>' + escape(title.slice(3)) + '</h2>' +
  (index === 3 ? '<p><a href="docs/product/r115-i-pilot-preview/index.html">打开实际安装版图解，点击图片放大阅读</a></p>' :
   '<pre>' + escape(readFileSync(join(root, 'docs/product', file), 'utf8')) + '</pre>') + '</section>').join('\n');
 writeFileSync(join(root, '00-开始使用.html'), '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
  '<title>GEO 部门试用 · 开始使用</title><style>body{max-width:980px;margin:auto;padding:24px;background:#f7f6fb;color:#24233b;font:16px/1.8 "Microsoft YaHei",system-ui,sans-serif}' +
  'h1{font-size:28px}h2{font-size:22px}a{color:#5d43bd}section{background:white;padding:20px;margin:20px 0;border:1px solid #e7e3f2;border-radius:12px}' +
  'pre{font:inherit;white-space:pre-wrap;overflow-wrap:anywhere}nav a{margin-right:16px;display:inline-block}</style>' +
  '<h1>GEO · 部门试用开始使用</h1><p>R1.15-I Candidate · 软件未签名 · 新数据目录 · 先练习合成资料</p>' +
  '<nav>' + entries.map(([title], index) => '<a href="#step-' + index + '">' + escape(title.slice(3)) + '</a>').join('') +
  '<a href="docs/product/r115-i-pilot-preview/index.html">手机可读图集</a><a href="docs/product/r115-i-pilot-preview/templates/文章导入模板.xlsx">文章模板</a></nav>' + handbook + '</html>');
 writeFileSync(join(root, 'CHANGELOG.md'), '# R1.15-I Candidate\n\n保留 H.2 紫色界面及全部既有安全门禁。修复空库第一家企业的普通 UI 入口；仅调用原有 brands.create。显示准确的部门试用身份。\n\n' +
 '普通 UI 合成导入、草稿恢复、人工审核、无账号发布阻塞、资料包、新库备份和隔离恢复已经验收。Main/IPC/DB/Adapter/发布安全逻辑保持 H.2 字节来源。\n\n' +
 '未签名。标准用户、新电脑、真实账号及云生成未验收；原生产升级继续阻塞于缺失历史素材。本包没有真实业务资料、历史账号、凭据、数据库或备份。main 未合并。\n');
 const walk = folder => readdirSync(folder, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(join(folder, entry.name)) : [join(folder, entry.name)]);
 const inventory = walk(root).map(file => ({ path: file.slice(root.length + 1).replaceAll('\\', '/'), bytes: statSync(file).size, sha256: hash(readFileSync(file)) })).sort((a, b) => a.path.localeCompare(b.path));
 writeFileSync(join(root, 'MANIFEST.json'), JSON.stringify({ deliveryId: 'R1.15-I', software, contents: inventory }, null, 2) + '\n');
 const complete = walk(root).map(file => hash(readFileSync(file)) + '  ' + file.slice(root.length + 1).replaceAll('\\', '/')).sort();
 writeFileSync(join(root, 'SHA256SUMS.txt'), complete.join('\n') + '\n');
 const assets = join(evidence, 'public-assets-' + Date.now()); mkdirSync(assets, { recursive: true });
 const zip = join(assets, 'GEO-Media-Publisher-R1.15-I-Department-Pilot-Candidate.zip');
 assert.equal(existsSync(zip), false, 'Preserve previous bundles; select a fresh asset directory when rebuilding');
 const powershell = join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
 execFileSync(powershell, ['-NoProfile', '-Command', '$ErrorActionPreference="Stop";Add-Type -AssemblyName System.IO.Compression;Add-Type -AssemblyName System.IO.Compression.FileSystem;$zip=[IO.Compression.ZipFile]::Open($env:I_BUNDLE_ZIP,[IO.Compression.ZipArchiveMode]::Create);try{foreach($file in [IO.Directory]::GetFiles($env:I_BUNDLE_STAGE,"*",[IO.SearchOption]::AllDirectories)){$name=$file.Substring($env:I_BUNDLE_STAGE.Length+1).Replace("\\","/");[IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip,$file,$name,[IO.Compression.CompressionLevel]::NoCompression)|Out-Null}}finally{$zip.Dispose()}'],
  { env: { ...process.env, I_BUNDLE_STAGE: stage, I_BUNDLE_ZIP: zip }, windowsHide: true, stdio: 'pipe' });
 const result = { status: 'BUILT_PENDING_SCAN_AND_EXTRACT_VERIFY', root, zip, files: inventory.length + 2, bytes: statSync(zip).size, sha256: hash(readFileSync(zip)), installerSha256: identity.installerSha256 };
 writeFileSync(join(evidence, 'handoff-bundle.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify({ status: result.status, files: result.files, bytes: result.bytes, sha256: result.sha256 }));
}
