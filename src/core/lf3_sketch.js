/*
 * lf3_sketch.js - LF3_Line_Follower.ino translated to JavaScript, function by function.
 *
 *   createLF3(arduino, settings, probe)  ->  { setup, loop, vars }
 *
 * - arduino : the Arduino functions the sketch calls (pinMode, digitalWrite, digitalRead, analogRead,
 *             analogWrite, millis, delay, Serial) - provided by world.js exactly like arduino_mock.h + sim.cpp.
 * - settings: values for the "const" settings (the same constants variants.py patches). Missing = sketch default.
 * - probe   : optional object the sketch writes notes into ("[probe]" lines) so the viewer can show which
 *             branch of followLine() ran. Probes only write to that object; they never change the logic.
 *
 * Every call to createLF3() makes a fresh copy of all global and static variables, like starting a new
 * C++ process for each run.  Integer behaviour:
 *   - millis() returns whole milliseconds; unsigned long differences go through usub() (64-bit unsigned,
 *     as unsigned long is 64 bits in the g++ build of the reference simulator)
 *   - constrain() is the arduino_mock.h macro; int / byte values stay whole numbers.
 */
(function (root) {
  'use strict';

  const ULONG_WRAP = 18446744073709551616; // 2^64
  function usub(a, b) { return a >= b ? a - b : a - b + ULONG_WRAP; } // unsigned long a - b

  function createLF3(A, S, probe) {
    S = S || {};
    probe = probe || {};
    const { pinMode, digitalWrite, digitalRead, analogRead, analogWrite, millis, delay, Serial } = A;
    const HIGH = 1, LOW = 0, INPUT = 0, OUTPUT = 1, INPUT_PULLUP = 2;
    const A1 = 15, A3 = 17, A5 = 19;
    const F = (s) => s;
    const constrain = (amt, low, high) => ((amt) < (low) ? (low) : ((amt) > (high) ? (high) : (amt)));
    const int = (v, d) => (v === undefined || v === null) ? d : Math.trunc(Number(v));
    const ulong = (v, d) => { const n = int(v, d); if (!(n >= 0)) throw new Error('unsigned setting must be >= 0'); return n; };

    // ---------------------------------------------------------------------
    // 1. PINS
    // ---------------------------------------------------------------------
    const PIN_ENA = 3, PIN_IN1 = 4, PIN_IN2 = 5, PIN_IN3 = 6, PIN_IN4 = 7, PIN_ENB = 11;
    const PIN_SENSOR_LEFT = A1, PIN_SENSOR_RIGHT = A3;
    const PIN_START = 12, PIN_LED = 13, PIN_BATTERY = A5;

    // ---------------------------------------------------------------------
    // 2. SETTINGS
    // ---------------------------------------------------------------------
    const SENSOR_HIGH_ON_BLACK = S.SENSOR_HIGH_ON_BLACK !== undefined ? !!S.SENSOR_HIGH_ON_BLACK : true;
    const LEFT_MOTOR_REVERSED = !!S.LEFT_MOTOR_REVERSED;
    const RIGHT_MOTOR_REVERSED = !!S.RIGHT_MOTOR_REVERSED;

    const SPEED_STRAIGHT = int(S.SPEED_STRAIGHT, 150);
    const SPEED_CROSSING = int(S.SPEED_CROSSING, 130);
    const TURN_OUTER = int(S.TURN_OUTER, 170);
    const TURN_INNER_SOFT = int(S.TURN_INNER_SOFT, 0);
    const TURN_INNER_SHARP = int(S.TURN_INNER_SHARP, -150);

    const SHARP_AFTER_MS = ulong(S.SHARP_AFTER_MS, 30);
    const START_DELAY_MS = ulong(S.START_DELAY_MS, 1000);
    const KICK_MS = ulong(S.KICK_MS, 40);
    const LIFTED_STOP_MS = ulong(S.LIFTED_STOP_MS, 1000);
    const LOST_AFTER_MS = ulong(S.LOST_AFTER_MS, 250);
    const SEARCH_GIVE_UP_MS = ulong(S.SEARCH_GIVE_UP_MS, 2000);

    const STOP_AT_STOP_BOX = !!S.STOP_AT_STOP_BOX;
    const STOP_BOX_MS = ulong(S.STOP_BOX_MS, 250);

    const STOP_AT_JUNCTION = int(S.STOP_AT_JUNCTION, 0);
    const JUNCTION_WAIT_MS = ulong(S.JUNCTION_WAIT_MS, 3000);

    const LOW_BATTERY_VOLTS = Math.fround(6.8);   // const float
    const DEBUG = !!S.DEBUG;

    // ---------------------------------------------------------------------
    // 3. VARIABLES
    // ---------------------------------------------------------------------
    let running = false;
    let batteryLow = false;
    let runStartedAt = 0;

    const ACT_STRAIGHT = 0, ACT_LEFT = 1, ACT_RIGHT = 2, ACT_CROSSING = 3, ACT_SEARCH_LEFT = 4, ACT_SEARCH_RIGHT = 5;
    let action = ACT_STRAIGHT;
    let actionSince = 0;
    let lineMemory = ACT_STRAIGHT;
    let junctionCount = 0;
    let lastDebugPrint = 0;

    // ---------------------------------------------------------------------
    // 4. MOTORS
    // ---------------------------------------------------------------------
    function setMotor(pinSpeed, pinDirA, pinDirB, speed, reversed) {
      if (reversed) speed = -speed;
      speed = constrain(speed, -255, 255);

      if (speed > 0) {
        digitalWrite(pinDirA, HIGH);
        digitalWrite(pinDirB, LOW);
      } else if (speed < 0) {
        digitalWrite(pinDirA, LOW);
        digitalWrite(pinDirB, HIGH);
        speed = -speed;
      } else {
        digitalWrite(pinDirA, LOW);
        digitalWrite(pinDirB, LOW);
      }
      analogWrite(pinSpeed, speed);
    }

    function drive(leftSpeed, rightSpeed) {
      setMotor(PIN_ENA, PIN_IN1, PIN_IN2, leftSpeed, LEFT_MOTOR_REVERSED);
      setMotor(PIN_ENB, PIN_IN3, PIN_IN4, rightSpeed, RIGHT_MOTOR_REVERSED);
    }

    function brakeMotors() {
      digitalWrite(PIN_IN1, LOW);
      digitalWrite(PIN_IN2, LOW);
      digitalWrite(PIN_IN3, LOW);
      digitalWrite(PIN_IN4, LOW);
      analogWrite(PIN_ENA, 255);
      analogWrite(PIN_ENB, 255);
    }

    // ---------------------------------------------------------------------
    // 5. SENSORS, BUTTON AND BATTERY
    // ---------------------------------------------------------------------
    function sensorOnBlack(pin) {
      const isHigh = (digitalRead(pin) === HIGH);
      if (SENSOR_HIGH_ON_BLACK) {
        return isHigh;
      }
      return !isHigh;
    }

    // static variables of startButtonPressed()
    let startButtonPressed_wasDown = false;
    let startButtonPressed_lastChange = 0;
    function startButtonPressed() {
      const isDown = (digitalRead(PIN_START) === LOW);
      if (isDown === startButtonPressed_wasDown) return false;
      if (usub(millis(), startButtonPressed_lastChange) < 50) return false;
      startButtonPressed_lastChange = millis();
      startButtonPressed_wasDown = isDown;
      return isDown;
    }

    function readBatteryVolts() {
      let total = 0;                                   // long
      for (let i = 0; i < 16; i++) {
        total += analogRead(PIN_BATTERY);
      }
      const pinVolts = Math.fround((total / 16.0) * 5.0 / 1023.0);   // float
      return Math.fround(pinVolts * 3.2);                            // returned as float
    }

    function checkBattery() {
      const volts = readBatteryVolts();
      batteryLow = (volts > 3.0 && volts < LOW_BATTERY_VOLTS);

      Serial.print(F('Battery: '));
      if (volts < 3.0) {
        Serial.println(F('not connected or switch OFF - the motors cannot run on USB power'));
      } else {
        Serial.print(volts, 1);
        Serial.println(batteryLow ? F(' V  LOW - please recharge') : F(' V  OK'));
      }
    }

    // ---------------------------------------------------------------------
    // 6. LINE FOLLOWING
    // ---------------------------------------------------------------------
    function setAction(newAction) {
      if (newAction === action) return false;
      action = newAction;
      actionSince = millis();
      return true;
    }

    function timeInAction() {
      return usub(millis(), actionSince);
    }

    function innerWheelSpeed() {
      if (timeInAction() < SHARP_AFTER_MS) {
        return TURN_INNER_SOFT;
      }
      return TURN_INNER_SHARP;
    }

    function stopRun(reason) {
      probe.phase = 'STOPPING'; probe.stopReason = reason;            // [probe]
      brakeMotors();
      delay(200);
      drive(0, 0);
      running = false;
      digitalWrite(PIN_LED, LOW);
      probe.phase = 'STOPPED';                                         // [probe]

      Serial.print(F('Stopped: '));
      Serial.println(reason);
      Serial.print(F('Run time: '));
      Serial.print(usub(millis(), runStartedAt) / 1000.0, 2);
      Serial.println(F(' s'));
      checkBattery();
    }

    function startRun() {
      digitalWrite(PIN_LED, HIGH);
      Serial.println(F('START pressed - starting in 1 second'));
      probe.phase = 'START_DELAY';                                     // [probe]
      delay(START_DELAY_MS);

      drive(255, 255);
      probe.phase = 'KICK';                                            // [probe]
      delay(KICK_MS);

      running = true;
      runStartedAt = millis();
      action = ACT_STRAIGHT;
      actionSince = millis();
      lineMemory = ACT_STRAIGHT;
      junctionCount = 0;
      probe.phase = 'RUNNING';                                         // [probe]
    }

    function stopAtJunction() {
      brakeMotors();
      Serial.print(F('Junction '));
      Serial.print(junctionCount);
      Serial.println(F(' - stopping'));
      if (JUNCTION_WAIT_MS === 0) {
        stopRun('stopped at the junction');
        return;
      }
      probe.phase = 'JUNCTION_WAIT';                                   // [probe]
      delay(JUNCTION_WAIT_MS);
      probe.phase = 'RUNNING';                                         // [probe]
      actionSince = millis();
    }

    function spin(toLeft) {
      if (toLeft) {
        drive(TURN_INNER_SHARP, TURN_OUTER);
      } else {
        drive(TURN_OUTER, TURN_INNER_SHARP);
      }
    }

    function followLine() {
      const left = sensorOnBlack(PIN_SENSOR_LEFT);
      const right = sensorOnBlack(PIN_SENSOR_RIGHT);
      probe.left = left; probe.right = right;                           // [probe]

      const searching = (action === ACT_SEARCH_LEFT || action === ACT_SEARCH_RIGHT);
      const sharpTurn = (action === ACT_LEFT || action === ACT_RIGHT) && timeInAction() >= SHARP_AFTER_MS;

      if (left && !right) {
        // BLACK | white : the line is under the left sensor -> turn left
        lineMemory = ACT_STRAIGHT;
        setAction(ACT_LEFT);
        probe.branch = (timeInAction() < SHARP_AFTER_MS) ? 1 : 2;       // [probe] 1 gentle left, 2 sharp left
        drive(innerWheelSpeed(), TURN_OUTER);
      }
      else if (!left && right) {
        // white | BLACK : the line is under the right sensor -> turn right
        lineMemory = ACT_STRAIGHT;
        setAction(ACT_RIGHT);
        probe.branch = (timeInAction() < SHARP_AFTER_MS) ? 3 : 4;       // [probe] 3 gentle right, 4 sharp right
        drive(TURN_OUTER, innerWheelSpeed());
      }
      else if (searching || (left && sharpTurn)) {
        // Spinning round a corner
        if (timeInAction() >= SEARCH_GIVE_UP_MS) {
          probe.branch = 6;                                              // [probe] give up
          stopRun('line lost - could not find it again');
          return;
        }
        probe.branch = 5;                                                // [probe] keep spinning
        spin(action === ACT_LEFT || action === ACT_SEARCH_LEFT);
      }
      else if (!left && !right) {
        // white | white : the line is between the sensors (or in a gap) -> straight on
        if (sharpTurn) {
          lineMemory = action;
        }
        setAction(ACT_STRAIGHT);
        if (lineMemory !== ACT_STRAIGHT && timeInAction() >= LOST_AFTER_MS) {
          // LINE MEMORY
          probe.branch = 8;                                              // [probe] start searching
          setAction(lineMemory === ACT_LEFT ? ACT_SEARCH_LEFT : ACT_SEARCH_RIGHT);
          lineMemory = ACT_STRAIGHT;
          spin(action === ACT_SEARCH_LEFT);
        } else {
          probe.branch = 7;                                              // [probe] straight
          drive(SPEED_STRAIGHT, SPEED_STRAIGHT);
        }
      }
      else {
        // BLACK | BLACK : a crossing line or a junction -> keep going straight
        lineMemory = ACT_STRAIGHT;
        probe.branch = 9;                                                // [probe] crossing
        if (setAction(ACT_CROSSING)) {
          junctionCount++;
          if (junctionCount === STOP_AT_JUNCTION) {
            stopAtJunction();
            return;
          }
        }
        if (STOP_AT_STOP_BOX && timeInAction() >= STOP_BOX_MS) {
          stopRun('stop box');
          return;
        }
        if (timeInAction() >= LIFTED_STOP_MS) {
          probe.branch = 10;                                             // [probe] lifted
          stopRun('both sensors saw black for 1 s (robot lifted?)');
          return;
        }
        drive(SPEED_CROSSING, SPEED_CROSSING);
      }

      if (DEBUG && usub(millis(), lastDebugPrint) >= 100) {
        lastDebugPrint = millis();
        Serial.print(left ? F('L:BLACK ') : F('L:white '));
        Serial.print(right ? F('R:BLACK  ') : F('R:white  '));
        if (action === ACT_STRAIGHT) Serial.println(F('straight'));
        else if (action === ACT_LEFT) Serial.println(F('turn left'));
        else if (action === ACT_RIGHT) Serial.println(F('turn right'));
        else if (action === ACT_CROSSING) Serial.println(F('crossing'));
        else Serial.println(F('searching for the line'));
      }
    }

    // ---------------------------------------------------------------------
    // 7. SETUP AND LOOP
    // ---------------------------------------------------------------------
    function setup() {
      pinMode(PIN_ENA, OUTPUT);
      pinMode(PIN_IN1, OUTPUT);
      pinMode(PIN_IN2, OUTPUT);
      pinMode(PIN_IN3, OUTPUT);
      pinMode(PIN_IN4, OUTPUT);
      pinMode(PIN_ENB, OUTPUT);
      drive(0, 0);

      pinMode(PIN_SENSOR_LEFT, INPUT);
      pinMode(PIN_SENSOR_RIGHT, INPUT);
      pinMode(PIN_START, INPUT_PULLUP);
      pinMode(PIN_LED, OUTPUT);

      Serial.begin(115200);
      Serial.println(F('Line follower ready - put it on the line and press START'));
      checkBattery();
      probe.phase = 'WAITING';                                           // [probe]
    }

    function loop() {
      if (!running) {
        const blinkTime = batteryLow ? 100 : 500;
        digitalWrite(PIN_LED, Math.floor(millis() / blinkTime) % 2 === 0 ? HIGH : LOW);
        if (startButtonPressed()) {
          startRun();
        }
        return;
      }

      if (startButtonPressed()) {
        stopRun('START pressed');
        return;
      }
      followLine();
    }

    // read-only view of the sketch's variables for the simulator (sim.cpp reads them directly too)
    const vars = {
      get running() { return running; },
      get action() { return action; },
      get actionSince() { return actionSince; },
      get lineMemory() { return lineMemory; },
      get junctionCount() { return junctionCount; },
      get runStartedAt() { return runStartedAt; },
      get batteryLow() { return batteryLow; },
    };
    const constants = { SPEED_STRAIGHT, SPEED_CROSSING, TURN_OUTER, TURN_INNER_SOFT, TURN_INNER_SHARP, SHARP_AFTER_MS,
      START_DELAY_MS, KICK_MS, LIFTED_STOP_MS, LOST_AFTER_MS, SEARCH_GIVE_UP_MS };
    return { setup, loop, vars, constants };
  }

  const api = { createLF3, usub };
  root.LF3Sketch = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
