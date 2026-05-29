/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        paper: { bg: "#F8F4EC", card: "#FFFDF8", sidebar: "#F3EDE3", border: "#E5DCCF", hover: "#EFE8DB" },
        ink: { DEFAULT: "#2F2A24", light: "#8A8176", faint: "#B8B0A6" },
        gold: { DEFAULT: "#B88A45", light: "#F6EFE2" },
        sage: { DEFAULT: "#6F8A6A", light: "#EFF3ED" },
      },
      fontFamily: { ui: ["PingFang SC","Microsoft YaHei","Hiragino Sans GB","system-ui","sans-serif"], prose: ["Noto Serif SC","Source Han Serif SC","Songti SC","SimSun","Georgia","serif"] },
      borderRadius: { card: "18px" },
    },
  },
  plugins: [],
};
