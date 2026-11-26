const providerNames: Record<string, string> = { google: 'Google Drive', mail: 'Облако Mail' };
import { Button } from '@/shared/ui/button';
import { ErrorMessage } from '@/shared/ui/error-message';
import { Modal } from '@/shared/ui/modal';
import { Select } from '@/shared/ui/select';
import type { useIntegrationsModel } from '../model/useIntegrationsModel';

type Props = Pick<
    ReturnType<typeof useIntegrationsModel>,
    | 'provider'
    | 'name'
    | 'setName'
    | 'email'
    | 'setEmail'
    | 'password'
    | 'setPassword'
    | 'authorization'
    | 'connectGoogle'
    | 'create'
    | 'chooseProvider'
    | 'closeConnect'
>;
export const ConnectDiskDialog = ({
    provider,
    name,
    setName,
    email,
    setEmail,
    password,
    setPassword,
    authorization,
    connectGoogle,
    create,
    chooseProvider,
    closeConnect,
}: Props) => (
    <Modal titleId="connect-disk-title" onClose={closeConnect} isBusy={create.isPending || connectGoogle.isPending}>
        <h2 id="connect-disk-title">Подключить диск</h2>
        <ErrorMessage error={create.error || connectGoogle.error || authorization.error} />
        <div className="cloud-provider-field">
            <Select
                label="Сервис"
                value={provider}
                options={[
                    { value: 'google', label: 'Google Drive' },
                    { value: 'mail', label: 'Облако Mail' },
                ]}
                onValueChange={(value) => chooseProvider(value === 'mail' ? 'mail' : 'google')}
            />
        </div>
        {provider !== 'mail' ? (
            <>
                {authorization.data && !authorization.data.data.available && (
                    <p className="muted">Подключение пока недоступно. Обратитесь к администратору.</p>
                )}
                <footer>
                    <Button variant="secondary" onClick={closeConnect} disabled={connectGoogle.isPending}>
                        Отмена
                    </Button>
                    <Button
                        disabled={connectGoogle.isPending || !authorization.data?.data.available}
                        onClick={() => connectGoogle.mutate(undefined)}
                    >
                        {connectGoogle.isPending ? 'Переходим к входу…' : `Подключить ${providerNames[provider]}`}
                    </Button>
                </footer>
            </>
        ) : (
            <form
                className="dialog-form"
                onSubmit={(e) => {
                    e.preventDefault();
                    create.mutate();
                }}
            >
                <label>
                    Название
                    <input
                        required
                        maxLength={100}
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Мой рабочий диск"
                    />
                </label>
                <label>
                    Почта Mail
                    <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
                </label>
                <label>
                    Пароль приложения
                    <input
                        type="password"
                        autoComplete="off"
                        required
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                    />
                </label>
                <footer>
                    <Button variant="secondary" type="button" onClick={closeConnect} disabled={create.isPending}>
                        Отмена
                    </Button>
                    <Button disabled={create.isPending}>{create.isPending ? 'Подключаем…' : 'Подключить'}</Button>
                </footer>
            </form>
        )}
    </Modal>
);
