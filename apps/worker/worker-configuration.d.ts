interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  APP_ENV: string;
  APP_VERSION: string;
  PRODUCT_BASE_URL: string;
  GITHUB_APP_ID: string;
  GITHUB_APP_SLUG: string;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  GITHUB_PRIVATE_KEY_PKCS8: string;
  GITHUB_WEBHOOK_SECRET: string;
  SESSION_SECRET: string;
  PADDLE_API_BASE_URL: string;
  PADDLE_API_KEY: string;
  PADDLE_WEBHOOK_SECRET: string;
  PADDLE_BINDING_SECRET: string;
  PADDLE_TEAM_PRICE_ID: string;
  PADDLE_FLEET_PRICE_ID: string;
}
