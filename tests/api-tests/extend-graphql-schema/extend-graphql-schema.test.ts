import { list, graphQLSchemaExtension, gql } from '@keystone-6/core';
import { allowAll } from '@keystone-6/core/access';
import { text } from '@keystone-6/core/fields';
import { setupTestRunner } from '@keystone-6/core/testing';
import { apiTestConfig, expectInternalServerError } from '../utils';
import { withServer } from '../with-server';

const falseFn: (...args: any) => boolean = () => false;

const withAccessCheck = <T, Args extends unknown[]>(
  access: boolean | ((...args: Args) => boolean),
  resolver: (...args: Args) => T
): ((...args: Args) => T) => {
  return (...args: Args) => {
    if (typeof access === 'function') {
      if (!access(...args)) {
        throw new Error('Access denied');
      }
    } else if (!access) {
      throw new Error('Access denied');
    }
    return resolver(...args);
  };
};

const runner = setupTestRunner({
  config: apiTestConfig({
    lists: {
      User: list({
        access: allowAll,
        fields: { name: text() },
      }),
    },
    extendGraphqlSchema: graphQLSchemaExtension({
      typeDefs: gql`
        type Query {
          double(x: Int): Int
          quads(x: Int): Int
        }
        type Mutation {
          triple(x: Int): Int
        }
      `,
      resolvers: {
        Query: {
          double: withAccessCheck(true, (_, { x }) => 2 * x),
          quads: withAccessCheck(falseFn, (_, { x }) => 4 * x),
          users: withAccessCheck(true, () => {
            return [{ name: 'foo' }];
          }),
        },
        Mutation: {
          triple: withAccessCheck(true, (_, { x }) => 3 * x),
        },
      },
    }),
  }),
});

describe('extendGraphqlSchema', () => {
  it(
    'Executes custom queries correctly',
    runner(async ({ context }) => {
      const data = await context.graphql.run({
        query: `
              query {
                double(x: 10)
              }
            `,
      });
      expect(data.double).toEqual(20);
    })
  );
  it(
    'Denies access acording to access control',
    withServer(runner)(async ({ graphQLRequest }) => {
      const { body } = await graphQLRequest({
        query: `
          query {
            quads(x: 10)
          }
        `,
      });
      expect(body.data).toEqual({ quads: null });
      expectInternalServerError(body.errors, false, [
        { path: ['quads'], message: 'Access denied' },
      ]);
    })
  );
  it(
    'Executes custom mutations correctly',
    runner(async ({ context }) => {
      const data = await context.graphql.run({
        query: `
              mutation {
                triple(x: 10)
              }
            `,
      });

      expect(data.triple).toEqual(30);
    })
  );
  it(
    'Default keystone resolvers remain unchanged',
    runner(async ({ context }) => {
      const data = await context.graphql.run({
        query: `
              mutation {
                createUser(data: { name: "Real User" }) {
                  name
                }
              }
            `,
      });

      expect(data.createUser.name).toEqual('Real User');
    })
  );
  it(
    'Overrides default keystone resolvers with custom resolvers',
    runner(async ({ context }) => {
      const data = await context.graphql.run({
        query: `
              query {
                users {
                  name
                }
              }
            `,
      });

      expect(data.users[0].name).toEqual('foo');
    })
  );
});
