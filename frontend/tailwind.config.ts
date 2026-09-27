import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        cp: {
          bg: '#0B0F14', panel: '#121821', panel2: '#171F2A', border: '#26303C', text: '#E7ECF1',
          muted: '#7C8898', dim: '#4B5563', safe: '#3FAE72', safeDim: '#1D3527', caution: '#E0A83E',
          cautionDim: '#3A2E17', critical: '#E0483E', criticalDim: '#3A1D1B', signal: '#4FA8D8',
        },
      },
      fontFamily: { mono: ['SF Mono', 'JetBrains Mono', 'Consolas', 'Monaco', 'monospace'] },
      animation: {
        'feed-in': 'feedIn .2s ease', 'zone-pulse': 'zonePulse 1.6s ease-in-out infinite',
        'web3-pulse': 'web3Pulse 2.2s ease-in-out infinite', 'ping-soft': 'pingSoft 1.7s ease-in-out infinite',
        'panel-in': 'panelIn .18s ease-out',
      },
      keyframes: {
        feedIn: { from: { opacity: '0', transform: 'translateY(-4px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
        zonePulse: { '0%,100%': { opacity: '1' }, '50%': { opacity: '.5' } },
        web3Pulse: {
          '0%,100%': { filter: 'drop-shadow(0 0 0 rgba(79,168,216,0))', transform: 'scale(1)' },
          '50%': { filter: 'drop-shadow(0 0 8px rgba(79,168,216,.65))', transform: 'scale(1.04)' },
        },
        pingSoft: {
          '0%,100%': { boxShadow: '0 0 0 0 rgba(63,174,114,.15)' },
          '50%': { boxShadow: '0 0 0 5px rgba(63,174,114,0)' },
        },
        panelIn: { from: { opacity: '0', transform: 'translateY(-5px) scale(.985)' }, to: { opacity: '1', transform: 'translateY(0) scale(1)' } },
      },
    },
  },
  plugins: [],
};

export default config;
