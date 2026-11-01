declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    DEEPSEEK_API_KEY?: string;
    DEEPSEEK_MODEL?: string;
    JOBS_IMPORT_TOKEN?: string;
    BUCKET?: R2Bucket;
  }
}
