import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

export async function getPublicIp(timeoutMs = 6000) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch('https://api.ipify.org?format=json', { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return data.ip || null;
  } catch {
    return null;
  }
}

export async function listAdbDevices() {
  try {
    const { stdout } = await execAsync('adb devices');
    const lines = stdout.split('\n').map(l => l.trim()).filter(Boolean);
    const devices = [];
    for (const line of lines.slice(1)) {
      const [id, state] = line.split(/\s+/);
      if (id && state === 'device') devices.push(id);
    }
    return devices;
  } catch {
    return [];
  }
}

export async function rotateMobileIp({ waitMs = 4000, deviceId = null } = {}) {
  const devices = await listAdbDevices();
  if (devices.length === 0) {
    return {
      success: false,
      skipped: true,
      reason: 'لا يوجد هاتف أندرويد متصل عبر USB/ADB حالياً.',
      timestamp: new Date().toISOString()
    };
  }

  const targetDevice = deviceId || devices[0];
  const targetFlag = targetDevice ? `-s ${targetDevice}` : '';

  const oldIp = await getPublicIp();

  try {
    // 1. تفعيل وضع الطيران (Airplane Mode ON)
    try {
      await execAsync(`adb ${targetFlag} shell cmd connectivity airplane-mode enable`);
    } catch {
      await execAsync(`adb ${targetFlag} shell settings put global airplane_mode_on 1`);
      await execAsync(`adb ${targetFlag} shell am broadcast -a android.intent.action.AIRPLANE_MODE --ez state true`);
    }

    // 2. الانتظار لقطع الاتصال بالبرج
    await new Promise(r => setTimeout(r, waitMs));

    // 3. تعطيل وضع الطيران (Airplane Mode OFF)
    try {
      await execAsync(`adb ${targetFlag} shell cmd connectivity airplane-mode disable`);
    } catch {
      await execAsync(`adb ${targetFlag} shell settings put global airplane_mode_on 0`);
      await execAsync(`adb ${targetFlag} shell am broadcast -a android.intent.action.AIRPLANE_MODE --ez state false`);
    }

    // 4. الانتظار حتى يلتقط الموبايل شبكة 4G جديدة
    await new Promise(r => setTimeout(r, 3000));

    const newIp = await getPublicIp();

    return {
      success: true,
      device: targetDevice,
      oldIp,
      newIp,
      changed: Boolean(oldIp && newIp && oldIp !== newIp),
      timestamp: new Date().toISOString()
    };
  } catch (err) {
    return {
      success: false,
      error: err.message,
      timestamp: new Date().toISOString()
    };
  }
}
