import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * Atlas Button — sharp 0px corners, mono uppercase tracked label for primary,
 * scale(0.97) on :active, custom ease-out. No rounded corners, no shadows.
 *
 * Variants:
 *   - default (primary): accent fill, mono uppercase
 *   - ghost: transparent with bottom underline on hover
 *   - outline: hairline border
 *   - destructive: red outline
 *   - link: inline text link
 *   - secondary: filled muted (alternative primary when accent is taken)
 */

const buttonVariants = cva(
  [
    "group/button inline-flex shrink-0 items-center justify-center",
    "whitespace-nowrap select-none cursor-pointer",
    "transition-transform duration-[var(--dur-normal)] ease-[cubic-bezier(0.23,1,0.32,1)]",
    "active:scale-[0.97]",
    "outline-none focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2",
    "disabled:pointer-events-none disabled:opacity-40",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
    "rounded-none",
  ].join(" "),
  {
    variants: {
      variant: {
        // Primary — accent fill, mono uppercase tracked
        default:
          "bg-primary text-primary-foreground font-mono uppercase tracking-[0.12em] text-xs hover:bg-[color-mix(in_oklch,var(--primary),white_10%)]",
        // Secondary — filled muted
        secondary:
          "bg-secondary text-secondary-foreground font-sans hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)]",
        // Outline — hairline border
        outline:
          "bg-transparent text-foreground border border-[var(--border-strong)] font-sans hover:bg-muted hover:border-foreground",
        // Ghost — transparent with bottom hairline that highlights to accent
        ghost:
          "bg-transparent text-foreground font-sans border-b border-[var(--border-strong)] hover:border-primary hover:text-primary px-0",
        // Destructive — red hairline
        destructive:
          "bg-transparent text-destructive border border-destructive font-mono uppercase tracking-[0.12em] text-xs hover:bg-destructive hover:text-background",
        // Link — inline text
        link: "text-primary underline-offset-4 hover:underline px-0 py-0 h-auto font-sans",
      },
      size: {
        default: "h-10 px-6",
        xs: "h-6 px-3 text-[10px]",
        sm: "h-8 px-4",
        lg: "h-12 px-8",
        icon: "size-10",
        "icon-xs": "size-6",
        "icon-sm": "size-8",
        "icon-lg": "size-12",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
