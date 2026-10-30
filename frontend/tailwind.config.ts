import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: 'var(--bg-base)',
        glass: 'var(--glass-bg)',
        racing: 'var(--accent-red)',
        data: 'var(--accent-cyan)',
      },
    },
  },
};

export default config;
