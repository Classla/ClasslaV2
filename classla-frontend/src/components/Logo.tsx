import React from "react";
import { FaGraduationCap } from "react-icons/fa";

interface LogoProps {
  size?: "sm" | "md" | "lg" | "xl";
  variant?: "default" | "white";
  className?: string;
  showFallback?: boolean;
}

const Logo: React.FC<LogoProps> = ({
  size = "md",
  variant = "default",
  className = "",
  showFallback = true,
}) => {
  const sizeClasses = {
    sm: "w-8 h-8",
    md: "w-12 h-12",
    lg: "w-16 h-16",
    xl: "w-24 h-24",
  };

  // Since the logo is white, we'll use it directly and add background when needed
  const logoPath = "/images/Classla-logo.png";

  const handleImageError = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.target as HTMLImageElement;

    // If logo fails to load and fallback is enabled, hide the image and show fallback
    if (showFallback) {
      img.style.display = "none";
      const fallback = img.nextElementSibling as HTMLElement;
      if (fallback) {
        fallback.style.display = "flex";
      }
    }
  };

  // For white logo: use purple background on light backgrounds, no background on dark
  const needsBackground = variant === "default";
  const backgroundClass = needsBackground
    ? "bg-purple-600 rounded-full p-3"
    : "";
  const logoSizeClass = needsBackground ? "w-full h-full" : sizeClasses[size];

  return (
    <div className={`relative ${sizeClasses[size]} ${className}`}>
      <div
        className={`${sizeClasses[size]} flex items-center justify-center ${backgroundClass}`}
      >
        <img
          src={logoPath}
          alt="Classla Logo"
          className={`${logoSizeClass} object-contain`}
          onError={handleImageError}
        />
      </div>
      {showFallback && (
        <div
          className={`${sizeClasses[size]} bg-purple-600 rounded-full items-center justify-center text-white hidden`}
          style={{ display: "none" }}
        >
          <FaGraduationCap
            className={
              size === "sm"
                ? "text-sm"
                : size === "lg"
                ? "text-2xl"
                : size === "xl"
                ? "text-3xl"
                : "text-lg"
            }
          />
        </div>
      )}
    </div>
  );
};

export default Logo;
