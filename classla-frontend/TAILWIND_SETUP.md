# Tailwind CSS & shadcn/ui Setup

This document outlines the setup of Tailwind CSS, shadcn/ui, and react-icons in the Classla LMS frontend.

## What's Been Added

### Dependencies

- `tailwindcss` - Utility-first CSS framework
- `postcss` & `autoprefixer` - CSS processing
- `tailwindcss-animate` - Animation utilities
- `class-variance-authority` - Component variant management
- `clsx` & `tailwind-merge` - Conditional class utilities
- `lucide-react` - Icon library (for shadcn/ui)
- `react-icons` - Popular icon library
- `@radix-ui/react-slot` & `@radix-ui/react-label` - Primitive components

### Configuration Files

- `tailwind.config.js` - Tailwind configuration with shadcn/ui setup
- `postcss.config.js` - PostCSS configuration
- `components.json` - shadcn/ui configuration

### Theme

- **Primary Color**: Purple (`hsl(262.1 83.3% 57.8%)`)
- **Light Theme**: Clean, professional appearance
- **CSS Variables**: Configured for easy theme customization

### Components Created

- `src/components/ui/button.tsx` - Button component with variants
- `src/components/ui/input.tsx` - Input field component
- `src/components/ui/card.tsx` - Card layout components
- `src/components/ui/alert.tsx` - Alert/notification component
- `src/components/ui/label.tsx` - Form label component
- `src/lib/utils.ts` - Utility functions for class merging

### Updated Pages

- **Sign In Page**: Professional design with purple branding, form validation, and responsive layout
- **Sign Up Page**: Split-screen design with feature highlights and benefits

## Features

### Sign In Page

- Clean, centered layout with purple gradient background
- Professional card-based form design
- Password visibility toggle
- Loading states for both email/password and Google sign-in
- Responsive design
- Error handling with styled alerts

### Sign Up Page

- Split-screen layout (desktop) with feature showcase
- Benefits list with checkmarks
- Mobile-responsive design
- Professional branding and messaging
- Consistent purple theme throughout

## Usage

The components follow shadcn/ui patterns and can be easily extended:

```tsx
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// Use in your components
<Card>
  <CardHeader>
    <CardTitle>My Card</CardTitle>
  </CardHeader>
  <CardContent>
    <Input placeholder="Enter text..." />
    <Button>Submit</Button>
  </CardContent>
</Card>;
```

## Adding More Components

To add more shadcn/ui components, you can:

1. Copy component code from [ui.shadcn.com](https://ui.shadcn.com)
2. Place in `src/components/ui/`
3. Install any required Radix UI dependencies
4. Import and use in your pages

## Customization

The theme can be customized by modifying the CSS variables in `src/index.css`:

```css
:root {
  --primary: 262.1 83.3% 57.8%; /* Purple theme */
  --secondary: 210 40% 96%;
  /* ... other variables */
}
```
