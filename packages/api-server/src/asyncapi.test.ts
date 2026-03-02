import { describe, it, expect } from 'vitest';
import { generateAsyncApiSpec } from './asyncapi.js';

describe('AsyncAPI Specification', () => {
  describe('generateAsyncApiSpec', () => {
    it('should generate a valid AsyncAPI specification', () => {
      const spec = generateAsyncApiSpec();
      expect(spec).toBeDefined();
      expect(spec.asyncapi).toBe('2.6.0');
    });

    it('should have required info fields', () => {
      const spec = generateAsyncApiSpec();
      expect(spec.info).toBeDefined();
      expect(spec.info.title).toBe('AI Team WebSocket API');
      expect(spec.info.version).toBe('0.1.0');
      expect(spec.info.description).toBeTruthy();
    });

    it('should define server configuration', () => {
      const spec = generateAsyncApiSpec();
      expect(spec.servers).toBeDefined();
      expect(spec.servers.development).toBeDefined();
      expect(spec.servers.development.url).toBe('ws://localhost:3002');
      expect(spec.servers.development.protocol).toBe('ws');
    });

    it('should define the chat channel', () => {
      const spec = generateAsyncApiSpec();
      expect(spec.channels).toBeDefined();
      expect(spec.channels['/ws/chat/{agentId}']).toBeDefined();
      
      const channel = spec.channels['/ws/chat/{agentId}'];
      expect(channel.description).toBeTruthy();
      expect(channel.parameters).toBeDefined();
      expect(channel.parameters.agentId).toBeDefined();
    });

    it('should define subscribe operation (server -> client events)', () => {
      const spec = generateAsyncApiSpec();
      const channel = spec.channels['/ws/chat/{agentId}'];
      
      expect(channel.subscribe).toBeDefined();
      expect(channel.subscribe.summary).toBeTruthy();
      expect(channel.subscribe.message).toBeDefined();
      expect(channel.subscribe.message.oneOf).toBeDefined();
      expect(channel.subscribe.message.oneOf.length).toBeGreaterThan(0);
    });

    it('should define publish operation (client -> server messages)', () => {
      const spec = generateAsyncApiSpec();
      const channel = spec.channels['/ws/chat/{agentId}'];
      
      expect(channel.publish).toBeDefined();
      expect(channel.publish.summary).toBeTruthy();
      expect(channel.publish.message).toBeDefined();
      expect(channel.publish.message.oneOf).toBeDefined();
      expect(channel.publish.message.oneOf.length).toBeGreaterThan(0);
    });

    describe('Client -> Server Messages', () => {
      it('should define ChatMessage schema', () => {
        const spec = generateAsyncApiSpec();
        const message = spec.components.messages.ChatMessage;
        
        expect(message).toBeDefined();
        expect(message.name).toBe('ChatMessage');
        expect(message.payload).toBeDefined();
        expect(message.payload.required).toContain('type');
        expect(message.payload.required).toContain('content');
        expect(message.payload.properties.type.const).toBe('message');
        expect(message.examples).toBeDefined();
        expect(message.examples.length).toBeGreaterThan(0);
      });

      it('should define CancelMessage schema', () => {
        const spec = generateAsyncApiSpec();
        const message = spec.components.messages.CancelMessage;
        
        expect(message).toBeDefined();
        expect(message.name).toBe('CancelMessage');
        expect(message.payload.properties.type.const).toBe('cancel');
      });

      it('should define AnswerMessage schema', () => {
        const spec = generateAsyncApiSpec();
        const message = spec.components.messages.AnswerMessage;
        
        expect(message).toBeDefined();
        expect(message.name).toBe('AnswerMessage');
        expect(message.payload.required).toContain('type');
        expect(message.payload.required).toContain('answer');
        expect(message.payload.properties.answer.properties.questionId).toBeDefined();
        expect(message.payload.properties.answer.properties.value).toBeDefined();
        expect(message.examples).toBeDefined();
        expect(message.examples.length).toBeGreaterThanOrEqual(3);
      });
    });

    describe('Server -> Client Events', () => {
      it('should define TokenEvent schema', () => {
        const spec = generateAsyncApiSpec();
        const event = spec.components.messages.TokenEvent;
        
        expect(event).toBeDefined();
        expect(event.name).toBe('TokenEvent');
        expect(event.payload.properties.type.const).toBe('token');
        expect(event.payload.properties.data).toBeDefined();
      });

      it('should define StatusEvent schema', () => {
        const spec = generateAsyncApiSpec();
        const event = spec.components.messages.StatusEvent;
        
        expect(event).toBeDefined();
        expect(event.name).toBe('StatusEvent');
        expect(event.payload.properties.type.const).toBe('status');
        expect(event.payload.properties.data.properties.status).toBeDefined();
        expect(event.examples).toBeDefined();
      });

      it('should define ToolEvent schema', () => {
        const spec = generateAsyncApiSpec();
        const event = spec.components.messages.ToolEvent;
        
        expect(event).toBeDefined();
        expect(event.name).toBe('ToolEvent');
        expect(event.payload.properties.type.const).toBe('tool');
      });

      it('should define QuestionEvent schema', () => {
        const spec = generateAsyncApiSpec();
        const event = spec.components.messages.QuestionEvent;
        
        expect(event).toBeDefined();
        expect(event.name).toBe('QuestionEvent');
        expect(event.payload.properties.type.const).toBe('question');
        expect(event.payload.properties.data.required).toContain('questionId');
        expect(event.payload.properties.data.required).toContain('kind');
        expect(event.payload.properties.data.required).toContain('message');
        expect(event.payload.properties.data.properties.kind.enum).toContain('input');
        expect(event.payload.properties.data.properties.kind.enum).toContain('confirm');
        expect(event.payload.properties.data.properties.kind.enum).toContain('select');
        expect(event.payload.properties.data.properties.kind.enum).toContain('checklist');
        expect(event.payload.properties.data.properties.kind.enum).toContain('password');
        expect(event.examples).toBeDefined();
        expect(event.examples.length).toBeGreaterThanOrEqual(3);
      });

      it('should define ErrorEvent schema', () => {
        const spec = generateAsyncApiSpec();
        const event = spec.components.messages.ErrorEvent;
        
        expect(event).toBeDefined();
        expect(event.name).toBe('ErrorEvent');
        expect(event.payload.properties.type.const).toBe('error');
        expect(event.payload.properties.data.required).toContain('error');
        expect(event.examples).toBeDefined();
      });

      it('should define DoneEvent schema', () => {
        const spec = generateAsyncApiSpec();
        const event = spec.components.messages.DoneEvent;
        
        expect(event).toBeDefined();
        expect(event.name).toBe('DoneEvent');
        expect(event.payload.properties.type.const).toBe('done');
      });
    });

    describe('Message References', () => {
      it('should reference all client message types in publish operation', () => {
        const spec = generateAsyncApiSpec();
        const publishMessages = spec.channels['/ws/chat/{agentId}'].publish.message.oneOf;
        
        const refs = publishMessages.map((msg: any) => msg.$ref);
        expect(refs).toContain('#/components/messages/ChatMessage');
        expect(refs).toContain('#/components/messages/CancelMessage');
        expect(refs).toContain('#/components/messages/AnswerMessage');
      });

      it('should reference all server event types in subscribe operation', () => {
        const spec = generateAsyncApiSpec();
        const subscribeMessages = spec.channels['/ws/chat/{agentId}'].subscribe.message.oneOf;
        
        const refs = subscribeMessages.map((msg: any) => msg.$ref);
        expect(refs).toContain('#/components/messages/TokenEvent');
        expect(refs).toContain('#/components/messages/StatusEvent');
        expect(refs).toContain('#/components/messages/ToolEvent');
        expect(refs).toContain('#/components/messages/QuestionEvent');
        expect(refs).toContain('#/components/messages/ErrorEvent');
        expect(refs).toContain('#/components/messages/DoneEvent');
      });
    });

    describe('Examples', () => {
      it('should provide examples for all message types', () => {
        const spec = generateAsyncApiSpec();
        const messages = spec.components.messages;
        
        // Check that key message types have examples
        expect(messages.ChatMessage.examples).toBeDefined();
        expect(messages.AnswerMessage.examples).toBeDefined();
        expect(messages.QuestionEvent.examples).toBeDefined();
        expect(messages.StatusEvent.examples).toBeDefined();
        expect(messages.ErrorEvent.examples).toBeDefined();
      });

      it('should have valid example payloads', () => {
        const spec = generateAsyncApiSpec();
        const chatMessage = spec.components.messages.ChatMessage.examples[0];
        
        expect(chatMessage.payload).toBeDefined();
        expect(chatMessage.payload.type).toBe('message');
        expect(chatMessage.payload.content).toBeTruthy();
      });
    });

    it('should generate spec that is JSON serializable', () => {
      const spec = generateAsyncApiSpec();
      
      // Should not throw
      expect(() => JSON.stringify(spec)).not.toThrow();
      
      const json = JSON.stringify(spec);
      expect(json.length).toBeGreaterThan(100);
      
      // Should be parseable
      const parsed = JSON.parse(json);
      expect(parsed.asyncapi).toBe('2.6.0');
    });
  });
});
