import serverlessExpress from '@vendia/serverless-express';
import { Callback, Context } from 'aws-lambda';

import app from './app';

const serverlessHandler = serverlessExpress({ app });

export const handler = async (event: unknown, context: Context): Promise<unknown> =>
	new Promise((resolve, reject) => {
		const callback: Callback<unknown> = (error, result) => {
			if (error) {
				reject(error);
				return;
			}

			resolve(result);
		};

		serverlessHandler(event, context, callback);
	});
