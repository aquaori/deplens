declare module "langchain" {
	export function createAgent(config: any): any;
	export function tool(handler: any, config: any): any;
}

declare module "@langchain/openai" {
	export class ChatOpenAI {
		constructor(config?: any);
		invoke(input: any): Promise<any>;
		stream(input: any): Promise<AsyncIterable<any>> | AsyncIterable<any>;
	}
}

declare module "zod" {
	export const object: any;
	export const string: any;
	const zodNamespace: any;
	export = zodNamespace;
}
