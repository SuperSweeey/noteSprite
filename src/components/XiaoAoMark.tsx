import Image from "next/image";

interface XiaoAoMarkProps {
  size?: "sm" | "md" | "lg";
  variant?: "logo" | "portrait" | "thinking" | "writing";
  className?: string;
}

const SIZE_MAP = {
  sm: 36,
  md: 52,
  lg: 72,
};

const SRC_MAP = {
  logo: "/xiaoao_logo.png",
  portrait: "/大头照.png",
  thinking: "/AI 思考中：托腮发呆.png",
  writing: "/新建笔记：抱着大铅笔.png",
};

export function XiaoAoMark({
  size = "md",
  variant = "logo",
  className = "",
}: XiaoAoMarkProps) {
  const px = SIZE_MAP[size];

  return (
    <div
      className={`overflow-hidden rounded-[22px] border border-black/5 bg-white shadow-[0_10px_28px_rgba(0,0,0,0.06)] ${className}`}
      style={{ width: px, height: px }}
    >
      <Image
        src={SRC_MAP[variant]}
        alt="AI"
        width={px}
        height={px}
        className="h-full w-full object-cover"
        priority={size !== "sm"}
      />
    </div>
  );
}
