/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./*.{html,js}"],
  darkMode: "class",

  safelist: [
    // Cores de Status (Verde, Amarelo, Vermelho, Cinza)
    "bg-emerald-500",
    "text-emerald-500",
    "shadow-[0_0_8px_rgba(16,185,129,0.5)]",
    "bg-amber-500",
    "text-amber-500",
    "shadow-[0_0_8px_rgba(245,158,11,0.5)]",
    "text-yellow-400",
    "text-yellow-500",
    "bg-yellow-500",
    "bg-red-500",
    "text-red-500",
    "text-red-400",
    "shadow-[0_0_8px_rgba(239,68,68,0.5)]",
    "bg-zinc-600",
    "text-zinc-400",
    "text-zinc-500",
    "text-zinc-600",
    "shadow-[0_0_8px_rgba(59,130,246,0.5)]",

    // Cores Específicas da Timeline/Detalhes
    "bg-blue-500",
    "text-blue-500",
    "text-blue-400",
    "border-blue-500",
    "shadow-[0_0_10px_rgba(59,130,246,0.4)]",
    "bg-zinc-700",
    "border-zinc-700",
    "bg-zinc-800",
    "border-zinc-600",
    "text-[var(--text-primary)]",
    "text-[var(--text-secondary)]",

    // Animações e Utilitários dinâmicos
    "animate-pulse",
    "line-through",
    "opacity-60",
    "grayscale-[0.5]",
    "opacity-100",
    "opacity-70",
    "opacity-0",
    "dot-ping",
    "w-full",
    "w-1/2",
  ],

  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "sans-serif"],
        mono: ["JetBrains Mono", "monospace"],
      },
      animation: {
        "fade-in": "fadeIn 0.6s ease-out forwards",
        "fade-in-up": "fadeInUp 0.8s ease-out forwards",
        float: "float 6s ease-in-out infinite",
        "pulse-slow": "pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite",
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: "0", transform: "translateY(10px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        fadeInUp: {
          "0%": { opacity: "0", transform: "translateY(20px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        float: {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-20px)" },
        },
      },
    },
  },
  plugins: [],
};
