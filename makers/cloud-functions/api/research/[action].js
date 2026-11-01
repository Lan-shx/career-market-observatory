import { legacyResearchRequest as researchRequest } from '../../../runtime/research-server.mjs';
import { getResearchDatabase } from '../../../lib/postgres.mjs';

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

export function createResearchHandler({ getDatabase = getResearchDatabase, fetcher = fetch } = {}) {
  return async function onRequest(context) {
    const { request } = context;
    const action = new URL(request.url).pathname.match(/^\/api\/research\/(status|start|continue|test)$/)?.[1];
    if (!action) return json({ error: '接口不存在' }, 404);
    const variable = name => context.env?.[name] ?? process.env[name];
    const env = {
      DEEPSEEK_API_KEY: variable('DEEPSEEK_API_KEY'),
      DEEPSEEK_MODEL: variable('DEEPSEEK_MODEL'),
    };
    try {
      // A personal key can be tested even before a database is configured.
      if (action !== 'test') env.DB = getDatabase(variable('DATABASE_URL'));
      if (action === 'status' && request.method === 'GET' && env.DB) {
        await env.DB.ready();
      }
    } catch {
      const reason = '研究存储尚未连接或未初始化，请站点维护者检查数据库配置。';
      if (action === 'status' && request.method === 'GET') {
        return json({ provider: 'DeepSeek', model: env.DEEPSEEK_MODEL || 'deepseek-flash',
          ready: false, reason, retentionMinutes: 60 });
      }
      return json({ error: reason }, 503);
    }
    return researchRequest(request, env, fetcher);
  };
}

export default createResearchHandler();
