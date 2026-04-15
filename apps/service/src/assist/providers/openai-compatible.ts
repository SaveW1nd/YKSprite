import { readFile } from 'node:fs/promises';

type OpenAICompatibleConfig = {
  apiKey: string;
  endpoint: string;
  model: string;
};

const encodeImage = async (imagePath: string) => {
  const buffer = await readFile(imagePath);
  return `data:image/png;base64,${buffer.toString('base64')}`;
};

export const requestOpenAICompatibleJson = async (
  config: OpenAICompatibleConfig,
  input: {
    imagePath: string;
    prompt: string;
  }
) => {
  const imageUrl = await encodeImage(input.imagePath);
  const response = await fetch(config.endpoint, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${config.apiKey}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: config.model,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: input.prompt },
            { type: 'image_url', image_url: { url: imageUrl } }
          ]
        }
      ]
    })
  });

  if (!response.ok) {
    throw new Error(`Vision request failed with status ${response.status}`);
  }

  const payload = (await response.json()) as {
    choices?: Array<{
      message?: {
        content?: string;
      };
    }>;
  };

  const content = payload.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('Vision provider returned no content');
  }

  return {
    rawResponseJson: JSON.stringify(payload),
    content
  };
};
