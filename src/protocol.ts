
// import { EventEmitter } from 'events';

// enum State {
// 	ParseHeaders = 1,
// 	ParseBody = 2
// }
// class ProtocolStreamReader extends EventEmitter {

// 	/**
// 	 * @param resource $input
// 	 */
// 	constructor(input: NodeJS.ReadableStream) {
// 		super();
// 		let buffer = '';
// 		let parsingMode = State.ParseHeaders;
// 		let contentLength: number;
// 		const headers = new Map<string, string>();
// 		input.on('data', chunk => {
// 			buffer += chunk;
// 			switch (parsingMode) {
// 				case State.ParseHeaders:
// 					const lines = buffer.split('\r\n');
// 					if (lines.length === 1) {
// 						// No new line
// 						return;
// 					}
// 					// Keep tail
// 					buffer = lines.pop()!;
// 					for (const line of lines) {
// 						const [header, value] = line.split(':');
// 						if (!header || !value) {
// 							this.emit('error', new Error(`Invalid header line ${line}`));
// 							return;
// 						}
// 						headers.set(header, value);
// 					}
// 						parsingMode = State.ParseBody;
// 						contentLength = +headers.get('Content-Length')!;
// 						if (isNaN(contentLength)) {
// 							this.emit('error', new Error(`Invalid Content-Length header ${headers.get('Content-Length')}`));
// 						}
// 						buffer = '';
// 					} else if (substr($this->buffer, -2) === "\r\n") {
// 						$parts = explode(':', $this->buffer);
// 						$this->headers[$parts[0]] = trim($parts[1]);
// 						$this->buffer = '';
// 					}
// 					break;
// 				case State.ParseBody:
// 					if (strlen($this->buffer) === $this->contentLength) {
// 						$msg = new Message(MessageBody::parse($this->buffer), $this->headers);
// 						$this->emit('message', [$msg]);
// 						$this->parsingMode = self::PARSE_HEADERS;
// 						$this->headers = [];
// 						$this->buffer = '';
// 					}
// 					break;
// 			}
// 		});
// 	}
// }
