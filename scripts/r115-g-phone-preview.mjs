import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
const acceptance = JSON.parse(readFileSync(resolve(process.argv[2]), 'utf8'));
const privateRows = JSON.parse(readFileSync(resolve(process.argv[3]), 'utf8'));
const destination = resolve(process.argv[4]);
assert.equal(acceptance.status, 'PASS'); assert.equal(acceptance.kind, 'INSTALLED_SYNTHETIC_UI_LOOPBACK_ONLY');
assert.equal(acceptance.screenshots.length, 8); assert.ok(Array.isArray(privateRows));
assert.ok(destination.startsWith(resolve('output') + '\\') || destination.startsWith(resolve('output') + '/'));
mkdirSync(destination, { recursive: true });
const captions = [
  ['导入错误与排除', 'CSV/XLSX 普通界面预览逐行错误；导入仅创建 Draft。'],
  ['自动保存与输入保护', 'Main 确认持久化后显示已保存；中文组合事件、粘贴、撤销与重做均参与隔离验收。'],
  ['崩溃恢复与差异选择', '强制终止本任务拥有的进程树后，查看差异并明确选择恢复；当前新版本不会被静默覆盖。'],
  ['AI 工作量与预算', '本机 mock 生成两个平台版本；基础请求与标题修复计入额度，跨企业总并发为 1。'],
  ['本地预检边界', '手选同企业图片；缺少已验证账号时提供连接入口并阻止后续准备。没有真实上传、远端草稿或最终提交。'],
  ['Owner 账号确认', '仅合成账号执行确认。真实历史账号只在私有副本预览，原生产归属修改数为 0。'],
  ['完整快照与隔离恢复', '独立本地进程等待应用退出后复制完整 userData；清单校验通过后恢复到新目录。'],
  ['恢复后的版本识别', '安装版显示 R1.15-G、实际构建时间与源码提交；恢复副本暂停调度和所有外部写操作。']
];
const shots = acceptance.screenshots.map((path, index) => {
  const source = resolve(path); assert.ok(existsSync(source)); assert.ok(source.startsWith(resolve(acceptance.root) + '\\') || source.startsWith(resolve(acceptance.root) + '/'));
  const file = basename(source); copyFileSync(source, join(destination, file));
  return { file, title: captions[index][0], description: captions[index][1] };
});
const pending = privateRows.filter(row => !row.currentCompanyId).map((row, index) => {
  assert.ok(['Unique', 'Conflict', 'NoEvidence'].includes(row.evidenceState));
  return { ordinal: String(index + 1).padStart(2, '0'), state: row.evidenceState, action: row.evidenceState === 'Conflict' ? '核对多企业历史使用，逐项决定归属' : row.evidenceState === 'Unique' ? '核对可定位的历史证据后确认' : '由 Owner 提供真实企业归属' };
});
const states = { Unique: '唯一历史建议', Conflict: '历史冲突', NoEvidence: '没有历史证据' };
const counts = Object.fromEntries(Object.keys(states).map(state => [state, pending.filter(row => row.state === state).length]));
writeFileSync(join(destination, 'owner-pending-redacted.json'), JSON.stringify({ kind: 'ANONYMOUS_OWNER_PENDING_LIST', total: pending.length, counts, productionAssignments: 0, realNamesIdsCompaniesAndEvidenceOmitted: true, accounts: pending }, null, 2));
const escape = text => String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>R1.15-G 实际软件预览</title>
<style>*{box-sizing:border-box}body{margin:0;background:#f1f4f8;color:#17283b;font:17px/1.65 system-ui,"Microsoft YaHei",sans-serif}main{max-width:760px;margin:auto;padding:18px}h1{font-size:25px;line-height:1.3}h2{font-size:21px}p{margin:10px 0}section{background:white;padding:18px;margin:18px 0;border-radius:14px;box-shadow:0 2px 12px #1734500d}img{width:100%;height:auto;border:1px solid #d6dee8;border-radius:8px}a{color:#145bc6;text-underline-offset:3px}small{font-size:14px;overflow-wrap:anywhere}li{margin:9px 0}.pill{display:inline-block;padding:3px 10px;border-radius:8px;background:#eaf1fb}details{border-top:1px solid #e1e7ef;padding:10px 0}summary{cursor:pointer;font-weight:600}.pending{padding-left:22px}.note{background:#edf6ff;padding:12px;border-radius:8px}</style>
<main><h1>R1.15-G<br>实际安装版操作预览</h1><p class="note">全部截图来自合成企业、合成账号和本地 mock 的实际软件渲染。点击图片打开原图，可在手机上放大查看。没有真实发帖或云生成。</p>
<section><h2>Owner 回到电脑后的操作</h2><ol><li>先正常关闭原软件，保留升级前整目录私有副本及 F 安装包，再核对 G 版本身份。</li><li>在「内容运营 → Owner 处理」核对 ${pending.length} 个待确认账号。先选择顶部企业工作区，再逐账号确认真实归属。</li><li>按平台正常流程登录或更新指定凭据，完成真实重启后的身份检查。</li><li>真实上传、远端草稿、云请求和最终发帖另行明确授权。</li></ol><p>当前历史建议：${counts.Unique} 个唯一建议、${counts.Conflict} 个冲突、${counts.NoEvidence} 个无证据。此清单已删除名称、ID、企业名称及原始证据；完整清单只留仓库外受限目录。</p><details><summary>展开 ${pending.length} 个匿名待确认项</summary><ol class="pending">${pending.map(row => `<li><strong>待确认账号 ${row.ordinal} · ${states[row.state]}</strong><br>${row.action}</li>`).join('')}</ol></details></section>
${shots.map((shot, index) => `<section><span class="pill">${index + 1} / 8</span><h2>${shot.title}</h2><p>${shot.description}</p><a href="${escape(shot.file)}" target="_blank" rel="noopener"><img src="${escape(shot.file)}" alt="${escape(shot.title)}的实际安装版截图" loading="lazy"></a><p><a href="${escape(shot.file)}" target="_blank" rel="noopener">打开原图并放大</a></p></section>`).join('')}
<section><h2>实测范围与身份</h2><p>Windows x64 NSIS 隔离安装；显式 userData；Main 与 Renderer 网络边界仅允许本机回环。截图状态覆盖 1366×768、1920×1080 的 100%、125%、150% 窗口缩放，共 ${acceptance.stateLayouts.length} 项检查。</p><p>实体 Windows DPI 和硬件输入法未操作；中文 DOM Composition 事件参与验收。跨 Windows 用户凭据迁移不作承诺，异机备份尚未配置，安装包未签名。</p><small>appVersion: ${escape(acceptance.build.appVersion)}<br>交付: ${escape(acceptance.build.deliveryId)}<br>源码: ${escape(acceptance.build.sourceCommit)}<br>构建: ${escape(acceptance.build.builtAt)}</small></section></main></html>`;
writeFileSync(join(destination, 'index.html'), html);
console.log(JSON.stringify({ status: 'PASS', index: join(destination, 'index.html'), actualScreenshots: shots.length, anonymousPendingAccounts: pending.length, counts }));
