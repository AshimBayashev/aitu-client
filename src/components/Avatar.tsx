import { useState } from "react";
import { avatarSrc } from "../api";
import { avatarColor, initials } from "../data";

export function Avatar({
  title,
  fileId,
  size = 42,
}: {
  title: string;
  fileId?: string | null;
  size?: number;
}) {
  const [broken, setBroken] = useState(false);
  const showPhoto = Boolean(fileId) && !broken;

  return (
    <span className="avatar" style={{ width: size, height: size, background: avatarColor(title) }}>
      {showPhoto ? (
        <img src={avatarSrc(fileId!)} alt="" onError={() => setBroken(true)} />
      ) : (
        initials(title)
      )}
    </span>
  );
}
