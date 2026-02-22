import React from "react";
import { useResolvedHtml } from "../hooks/useResolvedHtml";

interface ResolvedHtmlProps {
  html: string;
  className?: string;
  fallback?: string;
}

/**
 * Wrapper component around useResolvedHtml for use inside .map() loops
 * where hooks can't be called directly. Resolves <img data-s3-key> tags
 * to presigned S3 URLs before rendering.
 */
const ResolvedHtml: React.FC<ResolvedHtmlProps> = ({
  html,
  className,
  fallback,
}) => {
  const resolved = useResolvedHtml(html || fallback || "");

  return (
    <div
      className={className}
      dangerouslySetInnerHTML={{ __html: resolved }}
    />
  );
};

export default ResolvedHtml;
