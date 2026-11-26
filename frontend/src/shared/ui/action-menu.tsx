import type { ComponentProps } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { Popover } from './popover';

export const ActionMenu = ({ label, children }: Pick<ComponentProps<typeof Popover>, 'label' | 'children'>) => (
    <Popover
        label={label}
        align="end"
        variant="ghost"
        className="action-popover"
        trigger={<MoreHorizontal size={16} />}
    >
        {children}
    </Popover>
);
