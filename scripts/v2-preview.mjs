import fs from 'node:fs/promises'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const [template, runtime] = await Promise.all([
  fs.readFile(path.join(root, 'ui/trajectory-v2.html'), 'utf8'),
  fs.readFile(path.join(root, 'src/v2-runtime.mjs'), 'utf8'),
])
const durationMs = 252000
const labels = ['开始', '理解请求', '执行计划', '搜索资料', '生成草稿', '命令失败', '重试成功', '汇总分析', '搜索失败', '重试成功', '校验结果', '解析失败', '重试成功', '跳过步骤', '检查交付', '最终回答']
const categories = ['Search', 'Search', 'Read', 'Shell', 'Search', 'Read', 'Write', 'Search', 'Shell', 'Read', 'Search', 'Write', 'Read', 'Shell', 'Web']
const steps = labels.map((label, index) => ({ id:`step-${index + 1}`, index:index + 1, turn:1, startMs:index * 16000, endMs:Math.min(durationMs, index * 16000 + 9000), durationMs:9000, label, reasoningCount:index % 3, verdict:index === 13 ? 'skipped' : 'success', branchFromStepId:null }))
const tools = steps.slice(1).map((step, index) => ({ id:`tool-${index + 1}`, stepId:step.id, name:{ Read:'read_file', Search:'search', Shell:'exec_command', Write:'apply_patch', Web:'browser' }[categories[index]], category:categories[index], startMs:step.startMs + 2500, endMs:step.startMs + 4500 + (index % 5) * 2100, durationMs:2000 + (index % 5) * 2100, status:'success', retryClusterId:null, recovery:null, args:'{}', result:'ok' }))
;[[4,5,'retry-a'],[7,8,'retry-b'],[10,11,'retry-c']].forEach(([failed,recovered,id]) => { tools[failed].status='failed'; tools[failed].retryClusterId=id; tools[failed].recovery='strategy_changed'; tools[recovered].retryClusterId=id; tools[recovered].recovery='recovered' })
const modelCalls = Array.from({ length:152 }, (_, index) => { const total=index%37===6?10500:index%13===4?7000:80+(index*37%11)*26,u=index/151,contextRatio=u<.3?.1+.45*u/.3:u<.67?.55-.018*Math.sin(index/5):.53-.28*(u-.67)/.33; return { index:index + 1, atMs:1200 + index * 1650, input:total, cachedInput:index % 4 ? total * .46 : total * .12, cacheWriteInput:0, uncachedInput:index % 4 ? total * .34 : total * .72, reasoningOutput:index%8===2?total*.13:0, visibleOutput:index%17===3?total*.07:0, total, contextRatio, compacted:false } })
const snapshot = { version:2, session:{ id:'reference-session', status:'complete', model:'gpt-5.6-sol', effort:'high', startedAt:'2026-08-24T09:42:10+08:00', updatedAt:'2026-08-24T09:46:22+08:00', durationMs }, steps, tools, modelCalls, agents:[], findings:[{ title:'工具失败与重试', detail:'S6、S9、S12 出现 3 次失败，均通过重试恢复到主路径。' }, { title:'时间消耗分布', detail:'主要耗时集中在 0:40–3:10，工具调用保持稳定。' }, { title:'上下文压力可控', detail:'峰值上下文占用 56.3%，低于 70% 安全阈值。' }], metrics:{ turns:1, toolCalls:16, toolFailures:3, modelCalls:modelCalls.length, totalTokens:288197, contextPeakRatio:.563 } }
const boot = `<script>${runtime}</script><script>window.postMessage({kind:'trajectory-v2:snapshot',data:${JSON.stringify(snapshot)}},'*')</script>`
const page = template.replace('</body>', `${boot}</body>`)
const port = Number(process.env.TRAJECTORY_PREVIEW_PORT || 8097)
http.createServer((_, response) => { response.writeHead(200, { 'content-type':'text/html; charset=utf-8', 'content-length':Buffer.byteLength(page) }); response.end(page) }).listen(port, '127.0.0.1', () => console.log(`V2 preview http://127.0.0.1:${port}`))
