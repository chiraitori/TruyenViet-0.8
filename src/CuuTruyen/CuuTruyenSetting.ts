import {
    DUIButton,
    DUINavigationButton,
    SourceStateManager,
    RequestManager
} from '@paperback/types';

enum Domains {
    CUUTRUYEN = 'cuutruyen.net',
    NETTROM = 'nettrom.com',
    HETCUUTRUYEN = 'hetcuutruyen.net',
    CUUTRUYENPIP7Z = 'cuutruyenpip7z.site',
    CUUTRUYEN5C844 = 'cuutruyen5c844.site',
}

export const getDomain = async (stateManager: SourceStateManager): Promise<string> => {
    return (await stateManager.retrieve('domain') as string) ?? Domains.CUUTRUYEN;
};

// Auth credentials getters
export const getUsername = async (stateManager: SourceStateManager): Promise<string> => {
    return (await stateManager.retrieve('username') as string) ?? '';
};

export const getPassword = async (stateManager: SourceStateManager): Promise<string> => {
    return (await stateManager.retrieve('password') as string) ?? '';
};

// Token caching (expires in 7 days)
export const getAuthToken = async (stateManager: SourceStateManager): Promise<string> => {
    return (await stateManager.retrieve('auth_token') as string) ?? '';
};

export const setAuthToken = async (stateManager: SourceStateManager, token: string): Promise<void> => {
    await stateManager.store('auth_token', token);
};

export const getTokenExpiry = async (stateManager: SourceStateManager): Promise<number> => {
    return (await stateManager.retrieve('token_expiry') as number) ?? 0;
};

export const setTokenExpiry = async (stateManager: SourceStateManager, expiry: number): Promise<void> => {
    await stateManager.store('token_expiry', expiry);
};

// Login function
export const performLogin = async (stateManager: SourceStateManager, requestManager: RequestManager): Promise<string> => {
    const username = await getUsername(stateManager);
    const password = await getPassword(stateManager);
    
    if (!username || !password) {
        throw new Error('Please enter username and password first');
    }

    const domain = await getDomain(stateManager);
    const url = `https://${domain}/api/v2/login`;
    
    const request = App.createRequest({
        url,
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            'Accept': 'application/json, text/plain, */*',
            'Accept-Language': 'en-US,en;q=0.9',
            'Origin': `https://${domain}`,
            'Referer': `https://${domain}/login`,
        },
        data: `username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`
    });

    const response = await requestManager.schedule(request, 1);
    if (!response.data) {
        throw new Error('Login failed: No response');
    }

    const responseText = response.data as string;
    if (responseText.trim().startsWith('<')) {
        throw new Error('Login failed: Server returned an error page');
    }

    const result = JSON.parse(responseText);
    if (result.auth_token) {
        await setAuthToken(stateManager, result.auth_token);
        await setTokenExpiry(stateManager, Date.now() + 7 * 24 * 60 * 60 * 1000);
        return result.auth_token;
    }

    throw new Error(result.error || 'Login failed: Invalid credentials');
};

export const domainSettings = (stateManager: SourceStateManager): DUINavigationButton => {
    return App.createDUINavigationButton({
        id: 'domain_settings',
        label: 'Domain Settings',
        form: App.createDUIForm({
            sections: async () =>
                [
                    App.createDUISection({
                        isHidden: false,
                        id: 'content',
                        rows: async () => {
                            await Promise.all([
                                getDomain(stateManager)
                            ]);

                            return await [
                                App.createDUISelect({
                                    id: 'domain',
                                    label: 'Domain',
                                    options: [
                                        Domains.CUUTRUYEN,
                                        Domains.NETTROM,
                                        Domains.HETCUUTRUYEN,
                                        Domains.CUUTRUYENPIP7Z,
                                        Domains.CUUTRUYEN5C844
                                    ],
                                    labelResolver: async (option: string) => {
                                        switch (option) {
                                            case Domains.CUUTRUYEN:
                                                return 'Cuu Truyen (.net)';
                                            case Domains.NETTROM:
                                                return 'Net Trom (.com)';
                                            case Domains.HETCUUTRUYEN:
                                                return 'Het Cuu Truyen (.net)';
                                            case Domains.CUUTRUYENPIP7Z:
                                                return 'Cuu Truyen Pip7z (.site)';
                                            case Domains.CUUTRUYEN5C844:
                                                return 'Cuu Truyen 5c844 (.site)';
                                            default:
                                                return option;
                                        }
                                    },
                                    value: App.createDUIBinding({
                                        get: async () => [await getDomain(stateManager)],
                                        set: async (value: string[]) => {
                                            await stateManager.store('domain', value[0]);
                                        }
                                    }),
                                    allowsMultiselect: false
                                })
                            ];
                        }
                    })
                ]
        })
    });
};

export function resetSettings(stateManager: SourceStateManager): DUIButton {
    return App.createDUIButton({
        id: 'reset',
        label: 'Reset to Default',
        onTap: async () => {
            await stateManager.store('domain', Domains.CUUTRUYEN);
        }
    });
}

// Account settings for login
export const accountSettings = (stateManager: SourceStateManager, requestManager: RequestManager): DUINavigationButton => {
    return App.createDUINavigationButton({
        id: 'account_settings',
        label: 'Account Settings',
        form: App.createDUIForm({
            sections: async () => [
                App.createDUISection({
                    isHidden: false,
                    id: 'credentials',
                    header: 'CuuTruyen Account',
                    footer: 'Enter your CuuTruyen account credentials, then tap Login to authenticate.',
                    rows: async () => {
                        return [
                            App.createDUIInputField({
                                id: 'username',
                                label: 'Username',
                                value: App.createDUIBinding({
                                    get: async () => await getUsername(stateManager),
                                    set: async (value: string) => {
                                        await stateManager.store('username', value);
                                    }
                                })
                            }),
                            App.createDUISecureInputField({
                                id: 'password',
                                label: 'Password',
                                value: App.createDUIBinding({
                                    get: async () => await getPassword(stateManager),
                                    set: async (value: string) => {
                                        await stateManager.store('password', value);
                                    }
                                })
                            })
                        ];
                    }
                }),
                App.createDUISection({
                    isHidden: false,
                    id: 'login_section',
                    header: 'Login',
                    rows: async () => {
                        return [
                            App.createDUIButton({
                                id: 'login_button',
                                label: 'Login',
                                onTap: async () => {
                                    await performLogin(stateManager, requestManager);
                                }
                            })
                        ];
                    }
                }),
                App.createDUISection({
                    isHidden: false,
                    id: 'auth_status',
                    header: 'Authentication Status',
                    rows: async () => {
                        const token = await getAuthToken(stateManager);
                        const expiry = await getTokenExpiry(stateManager);
                        const now = Date.now();
                        const isValid = token && expiry > now;
                        let statusLabel = '❌ Not Logged In';
                        if (isValid) {
                            const daysLeft = Math.ceil((expiry - now) / (1000 * 60 * 60 * 24));
                            statusLabel = `✅ Logged In (${daysLeft} days left)`;
                        }
                        return [
                            App.createDUILabel({
                                id: 'token_status',
                                label: statusLabel
                            })
                        ];
                    }
                })
            ]
        })
    });
};

export function clearCredentials(stateManager: SourceStateManager): DUIButton {
    return App.createDUIButton({
        id: 'clear_credentials',
        label: 'Logout / Clear Credentials',
        onTap: async () => {
            await stateManager.store('username', '');
            await stateManager.store('password', '');
            await stateManager.store('auth_token', '');
            await stateManager.store('token_expiry', 0);
        }
    });
}