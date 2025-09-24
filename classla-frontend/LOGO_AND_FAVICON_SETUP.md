# Logo and Favicon Setup Guide

## 📁 File Structure

```
classla-frontend/
├── public/
│   ├── favicon.ico                    # Traditional favicon
│   ├── favicon-16x16.png             # 16x16 PNG favicon
│   ├── favicon-32x32.png             # 32x32 PNG favicon
│   ├── apple-touch-icon.png          # 180x180 for iOS
│   ├── android-chrome-192x192.png    # 192x192 for Android
│   ├── android-chrome-512x512.png    # 512x512 for Android
│   └── images/
│       ├── logo.svg                  # Main logo (SVG recommended)
│       ├── logo.png                  # PNG fallback
│       ├── logo-white.svg            # White version for dark backgrounds
│       └── logo-white.png            # White PNG fallback
└── src/
    └── components/
        └── Logo.tsx                  # Logo component (already created)
```

## 🎨 Logo Requirements

### Main Logo (`/public/images/logo.svg` or `/public/images/logo.png`)

- **Format**: SVG preferred (scalable), PNG as fallback
- **Size**: Vector (SVG) or high resolution PNG (200x200px minimum)
- **Background**: Transparent
- **Colors**: Should work on light backgrounds

### White Logo (`/public/images/logo-white.svg` or `/public/images/logo-white.png`)

- **Format**: Same as main logo
- **Colors**: White or light colors for dark backgrounds
- **Use**: Used on the purple gradient background in sign-up page

## 🔖 Favicon Requirements

### Files to Create:

1. **favicon.ico** - Traditional favicon (16x16, 32x32, 48x48 in one file)
2. **favicon-16x16.png** - 16x16 PNG
3. **favicon-32x32.png** - 32x32 PNG
4. **apple-touch-icon.png** - 180x180 for iOS
5. **android-chrome-192x192.png** - 192x192 for Android
6. **android-chrome-512x512.png** - 512x512 for Android

### Quick Generation:

- Use https://favicon.io/favicon-generator/
- Upload a square version of your logo
- Download and place files in `/public/` directory

## ✅ What's Already Done

1. **Logo Component**: Created `src/components/Logo.tsx` with:

   - Automatic fallback from SVG → PNG → Graduation cap icon
   - Multiple size options (sm, md, lg, xl)
   - White variant support
   - Error handling

2. **Updated Pages**:

   - Sign In page now uses `<Logo size="lg" />`
   - Sign Up page uses `<Logo size="lg" variant="white" />` on dark background
   - Mobile responsive logo placement

3. **HTML Setup**: Updated `index.html` with proper favicon references

4. **Fallback**: If logo files don't exist, shows purple graduation cap icon

## 🚀 Next Steps

1. **Add Your Logo Files**:

   ```bash
   # Place these files:
   classla-frontend/public/images/logo.svg          # Your main logo
   classla-frontend/public/images/logo-white.svg    # White version
   ```

2. **Add Favicon Files**:

   ```bash
   # Place these files:
   classla-frontend/public/favicon.ico
   classla-frontend/public/favicon-16x16.png
   classla-frontend/public/favicon-32x32.png
   classla-frontend/public/apple-touch-icon.png
   classla-frontend/public/android-chrome-192x192.png
   classla-frontend/public/android-chrome-512x512.png
   ```

3. **Test**: Restart dev server and check:
   - Logo appears on sign-in/sign-up pages
   - Favicon shows in browser tab
   - Mobile touch icons work

## 🎯 Logo Usage in Other Components

```tsx
import Logo from '@/components/Logo'

// Different sizes
<Logo size="sm" />   // 32x32px
<Logo size="md" />   // 48x48px (default)
<Logo size="lg" />   // 64x64px
<Logo size="xl" />   // 96x96px

// White variant for dark backgrounds
<Logo variant="white" />

// Custom styling
<Logo className="mx-auto" />

// Disable fallback icon
<Logo showFallback={false} />
```

The Logo component will automatically handle missing files and show the graduation cap icon as a fallback until you add your actual logo files.
