module.exports = {
  apps: [{
    name: 'dex-api',
    script: 'server/index.js',
    instances: 1,
    exec_mode: 'fork',
    watch: false,
    max_memory_restart: '500M',
    error_file: 'logs/dex-error.log',
    out_file: 'logs/dex-out.log',
    env: {
      NODE_ENV: 'production',
      PORT: 3030,
      // Set these in your .env file or system environment:
      // BLOCKCYPHER_TOKEN: 'your_token_here',
      // DB_PASSWORD: 'your_db_password',
      // ADMIN_ID: 'your_admin_username',
      // ADMIN_PASSWORD_HASH: 'bcrypt_hash',
      // JWT_SECRET: 'your_jwt_secret'
    }
  }]
};
