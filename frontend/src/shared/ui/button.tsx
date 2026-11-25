import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentPropsWithRef } from 'react';
import { cn } from '@/shared/lib/utils';
const buttonVariants = cva('button', {
    variants: {
        variant: {
            default: 'button-primary',
            secondary: 'button-secondary',
            ghost: 'button-ghost',
            destructive: 'button-danger',
        },
        size: { default: '', icon: 'button-icon', small: 'button-small' },
    },
    defaultVariants: { variant: 'default', size: 'default' },
});
type Props = ComponentPropsWithRef<'button'> & VariantProps<typeof buttonVariants> & { isRenderedAsChild?: boolean };
export const Button = ({ className, variant, size, isRenderedAsChild = false, ...props }: Props) => {
    const Component = isRenderedAsChild ? Slot : 'button';
    return (
        <Component
            className={cn(buttonVariants({ variant, size }), className)}
            title={size === 'icon' ? props['aria-label'] : undefined}
            {...props}
        />
    );
};
