module.exports = {
  apps: [
    {
      name: 'wasla',
      script: 'src/server.js',
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '500M'
    }
  ]
};
