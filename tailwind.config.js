/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/views/**/*.{ts,tsx}',
    './src/components/**/*.{ts,tsx}',
    './src/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        brand: { 50:'#fffbeb',100:'#fff3c4',200:'#ffe585',300:'#ffd23f',400:'#ffc300',500:'#f5a800',600:'#cc8400',700:'#9c6200',800:'#6e4400',900:'#473000' },
        ink: { 50:'#f6f7f9',100:'#eceef2',200:'#d4d8e0',300:'#aeb5c2',400:'#828c9e',500:'#626d80',600:'#4c5666',700:'#3e4654',800:'#363c47',900:'#21252d' },
      },
      fontFamily: {
        sans: ['-apple-system','BlinkMacSystemFont','"PingFang SC"','"Microsoft YaHei"','"Segoe UI"','Roboto','Helvetica','Arial','sans-serif'],
        mono: ['"SF Mono"','"JetBrains Mono"','Menlo','Consolas','monospace'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(16,24,40,.04), 0 4px 16px rgba(16,24,40,.06)',
        pop: '0 8px 30px rgba(16,24,40,.12)',
      },
      keyframes: {
        fadeUp: { '0%':{opacity:'0',transform:'translateY(6px)'},'100%':{opacity:'1',transform:'translateY(0)'} },
        pulseDot: { '0%,100%':{opacity:'1'},'50%':{opacity:'.35'} },
      },
      animation: {
        fadeUp: 'fadeUp .35s ease both',
        pulseDot: 'pulseDot 1s ease-in-out infinite',
      },
    },
  },
  plugins: [],
}
