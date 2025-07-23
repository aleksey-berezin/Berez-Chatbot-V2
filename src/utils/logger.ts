// Simple logger utility to control verbosity
export class Logger {
  private static isProd = process.env.NODE_ENV === 'production';

  static log(message: string, level: 'info' | 'debug' | 'warn' | 'error' = 'info') {
    // Always print info/debug in non-production
    if (this.isProd) {
      if (level === 'debug' && process.env.DEBUG !== 'true') return;
      if (level === 'info' && process.env.VERBOSE !== 'true' && process.env.DEBUG !== 'true') return;
    }
    const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
    console.log(`[${timestamp}] ${message}`);
  }

  static info(message: string) {
    this.log(message, 'info');
  }

  static debug(message: string) {
    this.log(message, 'debug');
  }

  static warn(message: string) {
    this.log(message, 'warn');
  }

  static error(message: string) {
    this.log(message, 'error');
  }
} 