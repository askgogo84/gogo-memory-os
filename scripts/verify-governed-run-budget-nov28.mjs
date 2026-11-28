import assert from 'node:assert/strict';
import { checkProjectedRunBudget } from '../lib/agent/governed-run-budget.mjs';
const cases = [
  [
    "exact boundary",
    {
      "caps": {
        "tokens": 100,
        "costMicropaise": 1000,
        "modelCalls": 4,
        "toolCalls": 3
      },
      "committed": {
        "tokens": 40,
        "costMicropaise": 300,
        "modelCalls": 1,
        "toolCalls": 1
      },
      "reserved": {
        "tokens": 10,
        "costMicropaise": 100,
        "modelCalls": 1,
        "toolCalls": 0
      },
      "next": {
        "tokens": 50,
        "costMicropaise": 600,
        "modelCalls": 1,
        "toolCalls": 0
      }
    },
    {
      "allowed": true,
      "reason": "within_projected_budget"
    }
  ],
  [
    "tokens over cap",
    {
      "caps": {
        "tokens": 100,
        "costMicropaise": 1000,
        "modelCalls": 4,
        "toolCalls": 3
      },
      "committed": {
        "tokens": 40,
        "costMicropaise": 300,
        "modelCalls": 1,
        "toolCalls": 1
      },
      "reserved": {
        "tokens": 10,
        "costMicropaise": 100,
        "modelCalls": 1,
        "toolCalls": 0
      },
      "next": {
        "tokens": 51,
        "costMicropaise": 600,
        "modelCalls": 1,
        "toolCalls": 0
      }
    },
    {
      "allowed": false,
      "reason": "projected_budget_exceeded",
      "dimension": "tokens"
    }
  ],
  [
    "cost over cap",
    {
      "caps": {
        "tokens": 100,
        "costMicropaise": 1000,
        "modelCalls": 4,
        "toolCalls": 3
      },
      "committed": {
        "tokens": 40,
        "costMicropaise": 300,
        "modelCalls": 1,
        "toolCalls": 1
      },
      "reserved": {
        "tokens": 10,
        "costMicropaise": 100,
        "modelCalls": 1,
        "toolCalls": 0
      },
      "next": {
        "tokens": 50,
        "costMicropaise": 601,
        "modelCalls": 1,
        "toolCalls": 0
      }
    },
    {
      "allowed": false,
      "reason": "projected_budget_exceeded",
      "dimension": "costMicropaise"
    }
  ],
  [
    "pending reservations count",
    {
      "caps": {
        "tokens": 100,
        "costMicropaise": 1000,
        "modelCalls": 4,
        "toolCalls": 3
      },
      "committed": {
        "tokens": 40,
        "costMicropaise": 300,
        "modelCalls": 1,
        "toolCalls": 1
      },
      "reserved": {
        "tokens": 11,
        "costMicropaise": 100,
        "modelCalls": 1,
        "toolCalls": 0
      },
      "next": {
        "tokens": 50,
        "costMicropaise": 600,
        "modelCalls": 1,
        "toolCalls": 0
      }
    },
    {
      "allowed": false,
      "reason": "projected_budget_exceeded",
      "dimension": "tokens"
    }
  ],
  [
    "model limit",
    {
      "caps": {
        "tokens": 100,
        "costMicropaise": 1000,
        "modelCalls": 4,
        "toolCalls": 3
      },
      "committed": {
        "tokens": 40,
        "costMicropaise": 300,
        "modelCalls": 1,
        "toolCalls": 1
      },
      "reserved": {
        "tokens": 10,
        "costMicropaise": 100,
        "modelCalls": 1,
        "toolCalls": 0
      },
      "next": {
        "tokens": 0,
        "costMicropaise": 0,
        "modelCalls": 3,
        "toolCalls": 0
      }
    },
    {
      "allowed": false,
      "reason": "projected_budget_exceeded",
      "dimension": "modelCalls"
    }
  ],
  [
    "tool limit",
    {
      "caps": {
        "tokens": 100,
        "costMicropaise": 1000,
        "modelCalls": 4,
        "toolCalls": 3
      },
      "committed": {
        "tokens": 40,
        "costMicropaise": 300,
        "modelCalls": 1,
        "toolCalls": 1
      },
      "reserved": {
        "tokens": 10,
        "costMicropaise": 100,
        "modelCalls": 1,
        "toolCalls": 0
      },
      "next": {
        "tokens": 0,
        "costMicropaise": 0,
        "modelCalls": 0,
        "toolCalls": 3
      }
    },
    {
      "allowed": false,
      "reason": "projected_budget_exceeded",
      "dimension": "toolCalls"
    }
  ],
  [
    "free known tool",
    {
      "caps": {
        "tokens": 100,
        "costMicropaise": 1000,
        "modelCalls": 4,
        "toolCalls": 3
      },
      "committed": {
        "tokens": 40,
        "costMicropaise": 300,
        "modelCalls": 1,
        "toolCalls": 1
      },
      "reserved": {
        "tokens": 10,
        "costMicropaise": 100,
        "modelCalls": 1,
        "toolCalls": 0
      },
      "next": {
        "tokens": 0,
        "costMicropaise": 0,
        "modelCalls": 0,
        "toolCalls": 1
      }
    },
    {
      "allowed": true,
      "reason": "within_projected_budget"
    }
  ],
  [
    "zero cost cap rejects paid tool",
    {
      "caps": {
        "tokens": 100,
        "costMicropaise": 0,
        "modelCalls": 4,
        "toolCalls": 3
      },
      "committed": {
        "tokens": 0,
        "costMicropaise": 0,
        "modelCalls": 0,
        "toolCalls": 0
      },
      "reserved": {
        "tokens": 0,
        "costMicropaise": 0,
        "modelCalls": 0,
        "toolCalls": 0
      },
      "next": {
        "tokens": 0,
        "costMicropaise": 1,
        "modelCalls": 0,
        "toolCalls": 1
      }
    },
    {
      "allowed": false,
      "reason": "projected_budget_exceeded",
      "dimension": "costMicropaise"
    }
  ],
  [
    "zero cost cap permits free tool",
    {
      "caps": {
        "tokens": 100,
        "costMicropaise": 0,
        "modelCalls": 4,
        "toolCalls": 3
      },
      "committed": {
        "tokens": 0,
        "costMicropaise": 0,
        "modelCalls": 0,
        "toolCalls": 0
      },
      "reserved": {
        "tokens": 0,
        "costMicropaise": 0,
        "modelCalls": 0,
        "toolCalls": 0
      },
      "next": {
        "tokens": 0,
        "costMicropaise": 0,
        "modelCalls": 0,
        "toolCalls": 1
      }
    },
    {
      "allowed": true,
      "reason": "within_projected_budget"
    }
  ],
  [
    "missing price",
    {
      "caps": {
        "tokens": 100,
        "costMicropaise": 1000,
        "modelCalls": 4,
        "toolCalls": 3
      },
      "committed": {
        "tokens": 40,
        "costMicropaise": 300,
        "modelCalls": 1,
        "toolCalls": 1
      },
      "reserved": {
        "tokens": 10,
        "costMicropaise": 100,
        "modelCalls": 1,
        "toolCalls": 0
      },
      "next": {
        "tokens": 1,
        "modelCalls": 1,
        "toolCalls": 0
      }
    },
    {
      "allowed": false,
      "reason": "invalid_budget_snapshot"
    }
  ],
  [
    "null price",
    {
      "caps": {
        "tokens": 100,
        "costMicropaise": 1000,
        "modelCalls": 4,
        "toolCalls": 3
      },
      "committed": {
        "tokens": 40,
        "costMicropaise": 300,
        "modelCalls": 1,
        "toolCalls": 1
      },
      "reserved": {
        "tokens": 10,
        "costMicropaise": 100,
        "modelCalls": 1,
        "toolCalls": 0
      },
      "next": {
        "tokens": 50,
        "costMicropaise": null,
        "modelCalls": 1,
        "toolCalls": 0
      }
    },
    {
      "allowed": false,
      "reason": "invalid_budget_snapshot"
    }
  ],
  [
    "string price",
    {
      "caps": {
        "tokens": 100,
        "costMicropaise": 1000,
        "modelCalls": 4,
        "toolCalls": 3
      },
      "committed": {
        "tokens": 40,
        "costMicropaise": 300,
        "modelCalls": 1,
        "toolCalls": 1
      },
      "reserved": {
        "tokens": 10,
        "costMicropaise": 100,
        "modelCalls": 1,
        "toolCalls": 0
      },
      "next": {
        "tokens": 50,
        "costMicropaise": "0",
        "modelCalls": 1,
        "toolCalls": 0
      }
    },
    {
      "allowed": false,
      "reason": "invalid_budget_snapshot"
    }
  ],
  [
    "negative reserved",
    {
      "caps": {
        "tokens": 100,
        "costMicropaise": 1000,
        "modelCalls": 4,
        "toolCalls": 3
      },
      "committed": {
        "tokens": 40,
        "costMicropaise": 300,
        "modelCalls": 1,
        "toolCalls": 1
      },
      "reserved": {
        "tokens": -1,
        "costMicropaise": 100,
        "modelCalls": 1,
        "toolCalls": 0
      },
      "next": {
        "tokens": 50,
        "costMicropaise": 600,
        "modelCalls": 1,
        "toolCalls": 0
      }
    },
    {
      "allowed": false,
      "reason": "invalid_budget_snapshot"
    }
  ],
  [
    "fractional token count",
    {
      "caps": {
        "tokens": 100,
        "costMicropaise": 1000,
        "modelCalls": 4,
        "toolCalls": 3
      },
      "committed": {
        "tokens": 40,
        "costMicropaise": 300,
        "modelCalls": 1,
        "toolCalls": 1
      },
      "reserved": {
        "tokens": 10,
        "costMicropaise": 100,
        "modelCalls": 1,
        "toolCalls": 0
      },
      "next": {
        "tokens": 0.5,
        "costMicropaise": 600,
        "modelCalls": 1,
        "toolCalls": 0
      }
    },
    {
      "allowed": false,
      "reason": "invalid_budget_snapshot"
    }
  ],
  [
    "invalid snapshot",
    null,
    {
      "allowed": false,
      "reason": "invalid_budget_snapshot"
    }
  ],
  [
    "missing cap",
    {
      "caps": {
        "tokens": 100,
        "costMicropaise": 1000,
        "modelCalls": 4
      },
      "committed": {
        "tokens": 40,
        "costMicropaise": 300,
        "modelCalls": 1,
        "toolCalls": 1
      },
      "reserved": {
        "tokens": 10,
        "costMicropaise": 100,
        "modelCalls": 1,
        "toolCalls": 0
      },
      "next": {
        "tokens": 50,
        "costMicropaise": 600,
        "modelCalls": 1,
        "toolCalls": 0
      }
    },
    {
      "allowed": false,
      "reason": "invalid_budget_snapshot"
    }
  ],
  [
    "missing operation",
    {
      "caps": {
        "tokens": 100,
        "costMicropaise": 1000,
        "modelCalls": 4,
        "toolCalls": 3
      },
      "committed": {
        "tokens": 40,
        "costMicropaise": 300,
        "modelCalls": 1,
        "toolCalls": 1
      },
      "reserved": {
        "tokens": 10,
        "costMicropaise": 100,
        "modelCalls": 1,
        "toolCalls": 0
      },
      "next": {
        "tokens": 0,
        "costMicropaise": 0,
        "modelCalls": 0,
        "toolCalls": 0
      }
    },
    {
      "allowed": false,
      "reason": "missing_operation"
    }
  ],
  [
    "already overspent",
    {
      "caps": {
        "tokens": 100,
        "costMicropaise": 1000,
        "modelCalls": 4,
        "toolCalls": 3
      },
      "committed": {
        "tokens": 101,
        "costMicropaise": 0,
        "modelCalls": 0,
        "toolCalls": 0
      },
      "reserved": {
        "tokens": 10,
        "costMicropaise": 100,
        "modelCalls": 1,
        "toolCalls": 0
      },
      "next": {
        "tokens": 0,
        "costMicropaise": 0,
        "modelCalls": 0,
        "toolCalls": 1
      }
    },
    {
      "allowed": false,
      "reason": "projected_budget_exceeded",
      "dimension": "tokens"
    }
  ],
  [
    "unsafe integer",
    {
      "caps": {
        "tokens": 100,
        "costMicropaise": 1000,
        "modelCalls": 4,
        "toolCalls": 3
      },
      "committed": {
        "tokens": 40,
        "costMicropaise": 300,
        "modelCalls": 1,
        "toolCalls": 1
      },
      "reserved": {
        "tokens": 10,
        "costMicropaise": 100,
        "modelCalls": 1,
        "toolCalls": 0
      },
      "next": {
        "tokens": 9007199254740992,
        "costMicropaise": 0,
        "modelCalls": 1,
        "toolCalls": 0
      }
    },
    {
      "allowed": false,
      "reason": "invalid_budget_snapshot"
    }
  ],
  [
    "sum would overflow",
    {
      "caps": {
        "tokens": 9007199254740991,
        "costMicropaise": 1000,
        "modelCalls": 4,
        "toolCalls": 3
      },
      "committed": {
        "tokens": 9007199254740990,
        "costMicropaise": 0,
        "modelCalls": 0,
        "toolCalls": 0
      },
      "reserved": {
        "tokens": 1,
        "costMicropaise": 0,
        "modelCalls": 0,
        "toolCalls": 0
      },
      "next": {
        "tokens": 1,
        "costMicropaise": 0,
        "modelCalls": 1,
        "toolCalls": 0
      }
    },
    {
      "allowed": false,
      "reason": "projected_budget_exceeded",
      "dimension": "tokens"
    }
  ],
  [
    "safe integer exact limit",
    {
      "caps": {
        "tokens": 9007199254740991,
        "costMicropaise": 1000,
        "modelCalls": 4,
        "toolCalls": 3
      },
      "committed": {
        "tokens": 9007199254740990,
        "costMicropaise": 0,
        "modelCalls": 0,
        "toolCalls": 0
      },
      "reserved": {
        "tokens": 1,
        "costMicropaise": 0,
        "modelCalls": 0,
        "toolCalls": 0
      },
      "next": {
        "tokens": 0,
        "costMicropaise": 0,
        "modelCalls": 1,
        "toolCalls": 0
      }
    },
    {
      "allowed": true,
      "reason": "within_projected_budget"
    }
  ]
];
for (const [name,input,expected] of cases) {
  const before = JSON.stringify(input);
  assert.deepEqual(checkProjectedRunBudget(input),expected,name);
  assert.equal(JSON.stringify(input),before,name+' mutated input');
}
const seed=cases[0][1];
for (const value of [NaN,Infinity,-Infinity]) {
  assert.deepEqual(checkProjectedRunBudget({...seed,next:{...seed.next,costMicropaise:value}}),{allowed:false,reason:'invalid_budget_snapshot'});
}
assert.deepEqual(checkProjectedRunBudget({...seed,next:Object.create(seed.next)}),{allowed:false,reason:'invalid_budget_snapshot'});
console.log('Governed run budget: 25 synthetic cases passed (no provider traffic)');
