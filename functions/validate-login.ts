import { validateLogin } from './lib/contact';

export const config: SwellConfig = {
  description: 'Validate Omnisend API key by attempting a test contact creation',
  route: {
    methods: ['post'],
    public: false,
  },
};

export async function post(req: SwellRequest) {
  const { api_key } = req.data as { api_key?: string };

  if (!api_key) {
    throw new SwellError('api_key is required', { status: 400 });
  }

  const success = await validateLogin(api_key);
  return { success };
}
