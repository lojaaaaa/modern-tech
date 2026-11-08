import type { components } from './schema';
export type Role = 'admin' | 'employee' | 'observer';
export type User = Pick<components['schemas']['User'], 'id' | 'name' | 'email' | 'active' | 'email_verified_at'> & {
    role: Role;
};
export type RegistrationInput = components['schemas']['RegisterRequest'];
export type DocumentRecord = components['schemas']['DocumentResource'] & { snippet?: string | null };
export type Version = NonNullable<DocumentRecord['version']>;
export type CloudConnection = components['schemas']['CloudConnection'];
export type CloudTransfer = components['schemas']['CloudTransfer'];
export interface Page<T> {
    data: T[];
    meta: { current_page: number; last_page: number; per_page: number; total: number };
}
export interface Resource<T> {
    data: T;
}
export interface CommentRecord {
    resolved_at: string | null;
    anchor_start: number | null;
    anchor_end: number | null;
    anchor_quote: string | null;
    id: string;
    author_id: number;
    author_name: string;
    body: string;
    version_id: string;
    revision: number;
    deleted_at: string | null;
    created_at: string;
}
