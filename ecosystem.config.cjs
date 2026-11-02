module.exports = {
  apps: [
    {
      name: 'wasla',
      script: 'src/server.js',
      cwd: './',
      instances: 1,
      exec_mode: 'fork',
      node_args: '--env-file=.env',
      env: {
        NODE_ENV: 'production',
        PORT: process.env.PORT || 3080
      },
      watch: false,
      max_memory_restart: '500M'
    }
  ]
};
