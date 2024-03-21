"use client";

import Image from "next/image";
import { useState } from "react";
import Draggable from "react-draggable";

export default function Home() {
  return (
    <main className="w-[100vw] h-[100vh] overflow-hidden">
      <IconContainer>
        <Icon title="DESKTOP ICON" src="/folder.png" />
        <Icon title="DESKTOP ICON" src="/folder.png" />
        <Icon title="DESKTOP ICON" src="/folder.png" />
        <Icon title="DESKTOP ICON" src="/folder.png" />
      </IconContainer>
    </main>
  );
}

function Icon({
  title,
  src,
  className,
  ...props
}: {
  title: string;
  className?: string;
  src: string;
}) {
  return (
    <div
      className={`w-[100px] h-[120px] flex flex-col justify-center items-center text-center overflow-hidden hover:bg-[rgba(255,255,255,0.2)] pb-3 ${className}`}
      {...props}
    >
      <Image src={src} width={64} height={64} alt="Desktop icon" />
      <h3 className="select-none">{title.substring(0, 12)}</h3>
    </div>
  );
}

function IconContainer({ children }: { children: React.ReactNode[] }) {
  return (
    <div
      className={`absolute top-0 bottom-0 right-0 left-0 p-4 flex flex-col flex-wrap gap-4`}
    >
      {children.map((item, index) => {
        return (
          <Draggable key={index} grid={[116, 136]}>
            {item}
          </Draggable>
        );
      })}
    </div>
  );
}
