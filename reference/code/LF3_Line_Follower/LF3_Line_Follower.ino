/*
 * =====================================================================
 *  LINE FOLLOWER ROBOT  -  main program                LF3_Line_Follower
 *  TechRadiance Jr. World Cup 2026  -  Line Follower Robot
 * =====================================================================
 *
 *  HARDWARE
 *    Arduino UNO with the Line Follower Carrier Shield v1.0 (our PCB) on top
 *    L298N motor driver  ->  2 BO motors
 *        left motor  on L298N OUT1 / OUT2   (controlled by ENA, IN1, IN2)
 *        right motor on L298N OUT3 / OUT4   (controlled by ENB, IN3, IN4)
 *    2 IR sensor modules (3-pin, digital) on the shield ports LEFT A1 and RIGHT A3
 *    START button (D12) and red RUN LED (D13) on the shield
 *
 *  THE IDEA  (simple rules - PID is not allowed by the competition rules)
 *    The two sensors sit just OUTSIDE the two edges of the black line,
 *    so when the robot is centred both of them see white.
 *
 *      LEFT sensor   RIGHT sensor   what it means                  what we do
 *      white         white          line is between the sensors    go straight
 *      BLACK         white          robot has drifted right        turn left
 *      white         BLACK          robot has drifted left         turn right
 *      BLACK         BLACK          a crossing line or junction    keep going straight
 *
 *    Two extra rules make it reliable on sharp bends and corners:
 *    1. GENTLE, THEN SHARP: a turn starts gentle (inner wheel stopped). If the
 *       sensor is still on black after SHARP_AFTER_MS milliseconds, the bend
 *       is sharp, so the inner wheel runs backwards and the robot spins.
 *    2. LINE MEMORY: after a sharp turn the robot remembers which way it
 *       was turning. If it then sees no line at all for LOST_AFTER_MS, it has
 *       shot past a sharp corner, so it spins back that way until a sensor
 *       finds the line. (Both sensors black during a sharp turn is treated
 *       as a corner too, not as a crossing.)
 *
 *  BEFORE THE FIRST RUN
 *    1. Upload LF1_Sensor_Test  -> adjust the sensors, set SENSOR_HIGH_ON_BLACK.
 *    2. Upload LF2_Motor_Test   -> check wheel directions, set *_MOTOR_REVERSED.
 *    3. Upload this program. Put the robot on the line, press START.
 *       It waits 1 second, then runs. Press START again to stop it.
 *
 *  RUN LED:  slow blink = ready, waiting for START
 *            fast blink = ready, but the battery is low
 *            steady ON  = running
 * =====================================================================
 */


// ---------------------------------------------------------------------
// 1. PINS  -  fixed by the PCB tracks, do not change
// ---------------------------------------------------------------------
const byte PIN_ENA = 3;     // L298N ENA : left motor speed  (PWM pin)
const byte PIN_IN1 = 4;     // L298N IN1 : left motor direction
const byte PIN_IN2 = 5;     // L298N IN2 : left motor direction
const byte PIN_IN3 = 6;     // L298N IN3 : right motor direction
const byte PIN_IN4 = 7;     // L298N IN4 : right motor direction
const byte PIN_ENB = 11;    // L298N ENB : right motor speed (PWM pin)

const byte PIN_SENSOR_LEFT  = A1;   // shield port "LEFT A1"
const byte PIN_SENSOR_RIGHT = A3;   // shield port "RIGHT A3"

const byte PIN_START   = 12;   // START button: reads LOW while it is pressed
const byte PIN_LED     = 13;   // red RUN LED on the shield (and the UNO's own "L" LED)
const byte PIN_BATTERY = A5;   // battery voltage, divided by 3.2 on the shield


// ---------------------------------------------------------------------
// 2. SETTINGS  -  the numbers you tune on the practice track
// ---------------------------------------------------------------------

// Sensors. Most 3-pin IR modules give HIGH over black and LOW over white.
// LF1_Sensor_Test shows which way round yours are.
const bool SENSOR_HIGH_ON_BLACK = true;

// Motors. If a wheel turns the wrong way in LF2_Motor_Test, change its
// line to true (or swap that motor's two wires on the L298N).
const bool LEFT_MOTOR_REVERSED  = false;
const bool RIGHT_MOTOR_REVERSED = false;

// Motor power for each situation: 0 = off, 255 = full power, minus = backwards.
const int SPEED_STRAIGHT   = 150;   // both wheels, line between the sensors
const int SPEED_CROSSING   = 130;   // both wheels, driving over a crossing line
const int TURN_OUTER       = 170;   // outer wheel in every turn
const int TURN_INNER_SOFT  = 0;     // inner wheel in a gentle turn  (stopped)
const int TURN_INNER_SHARP = -150;  // inner wheel in a sharp turn   (backwards = spin)

// Timing, in milliseconds (1000 ms = 1 second).
const unsigned long SHARP_AFTER_MS = 30;    // sensor on black this long -> treat it as a sharp bend
const unsigned long START_DELAY_MS = 1000;  // time to move your hand away after pressing START
const unsigned long KICK_MS        = 40;    // short full-power push so the wheels start together
const unsigned long LIFTED_STOP_MS = 1000;  // both sensors black this long -> robot lifted up: stop
const unsigned long LOST_AFTER_MS  = 250;   // line memory: no line this long after a sharp turn -> search
const unsigned long SEARCH_GIVE_UP_MS = 2000; // spinning this long without finding the line -> stop

// Optional: stop by itself on a wide black "stop box" (both sensors black for a while).
// Leave false unless your track has a stop box; a crossing line is much shorter than this.
const bool STOP_AT_STOP_BOX = false;
const unsigned long STOP_BOX_MS = 250;

// Optional, for the Final: stop at a junction (the rules give challenge points for it).
// Every place where BOTH sensors see black (a crossing or a junction) is counted.
//   0       = never stop, drive straight over all of them
//   1, 2, 3 = stop at that junction, wait JUNCTION_WAIT_MS, then carry on
// Only switch this on once you have seen the track layout.
const int STOP_AT_JUNCTION = 0;
const unsigned long JUNCTION_WAIT_MS = 3000;    // 0 = stay stopped (end of the run)

// Battery: 2 Li-ion cells in series = 8.4 V full, 7.4 V normal. Recharge below about 6.8 V.
const float LOW_BATTERY_VOLTS = 6.8;

// true = print what the sensors see while running (Serial Monitor, 115200 baud).
// Printing slows the program down a little, so switch it off for real runs.
const bool DEBUG = false;


// ---------------------------------------------------------------------
// 3. VARIABLES  -  what the program remembers between loops
// ---------------------------------------------------------------------
bool running = false;             // false = waiting for START, true = following the line
bool batteryLow = false;          // set by checkBattery()
unsigned long runStartedAt = 0;   // millis() when the run began, for the run time

// What the robot is doing right now, and since when.
const byte ACT_STRAIGHT = 0;
const byte ACT_LEFT     = 1;
const byte ACT_RIGHT    = 2;
const byte ACT_CROSSING = 3;
const byte ACT_SEARCH_LEFT  = 4;  // line memory: spinning left to find the line again
const byte ACT_SEARCH_RIGHT = 5;  // line memory: spinning right to find the line again
byte action = ACT_STRAIGHT;
unsigned long actionSince = 0;
byte lineMemory = ACT_STRAIGHT;   // side of the last sharp turn (ACT_STRAIGHT = nothing remembered)
int junctionCount = 0;            // crossings/junctions passed in this run
unsigned long lastDebugPrint = 0;


// ---------------------------------------------------------------------
// 4. MOTORS
// ---------------------------------------------------------------------

// Run one motor. speed: -255 (full backwards) ... 0 (off) ... +255 (full forwards)
void setMotor(byte pinSpeed, byte pinDirA, byte pinDirB, int speed, bool reversed) {
  if (reversed) speed = -speed;
  speed = constrain(speed, -255, 255);

  if (speed > 0) {                 // forwards: IN pins HIGH, LOW
    digitalWrite(pinDirA, HIGH);
    digitalWrite(pinDirB, LOW);
  } else if (speed < 0) {          // backwards: IN pins LOW, HIGH
    digitalWrite(pinDirA, LOW);
    digitalWrite(pinDirB, HIGH);
    speed = -speed;                // the speed pin only takes 0..255
  } else {                         // off: no power, the wheel rolls freely
    digitalWrite(pinDirA, LOW);
    digitalWrite(pinDirB, LOW);
  }
  analogWrite(pinSpeed, speed);    // PWM: how much of the time the motor gets power
}

// Run both motors.
void drive(int leftSpeed, int rightSpeed) {
  setMotor(PIN_ENA, PIN_IN1, PIN_IN2, leftSpeed, LEFT_MOTOR_REVERSED);
  setMotor(PIN_ENB, PIN_IN3, PIN_IN4, rightSpeed, RIGHT_MOTOR_REVERSED);
}

// Stop quickly: both motor wires are connected together inside the L298N,
// which turns each motor into a brake.
void brakeMotors() {
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

// true if this sensor is over the black line
bool sensorOnBlack(byte pin) {
  bool isHigh = (digitalRead(pin) == HIGH);
  if (SENSOR_HIGH_ON_BLACK) {
    return isHigh;
  }
  return !isHigh;
}

// true only at the moment the START button is pushed down (not while it is held)
bool startButtonPressed() {
  static bool wasDown = false;
  static unsigned long lastChange = 0;

  bool isDown = (digitalRead(PIN_START) == LOW);
  if (isDown == wasDown) return false;            // nothing changed
  if (millis() - lastChange < 50) return false;   // ignore contact bounce (50 ms)
  lastChange = millis();
  wasDown = isDown;
  return isDown;
}

// Battery voltage in volts (measured after the protection diode, about 0.3 V below the cells)
float readBatteryVolts() {
  long total = 0;
  for (byte i = 0; i < 16; i++) {       // average 16 readings to remove noise
    total += analogRead(PIN_BATTERY);
  }
  float pinVolts = (total / 16.0) * 5.0 / 1023.0;   // 0..1023 -> 0..5 V on pin A5
  return pinVolts * 3.2;                            // undo the divider: (22k + 10k) / 10k = 3.2
}

void checkBattery() {
  float volts = readBatteryVolts();
  batteryLow = (volts > 3.0 && volts < LOW_BATTERY_VOLTS);

  Serial.print(F("Battery: "));
  if (volts < 3.0) {
    Serial.println(F("not connected or switch OFF - the motors cannot run on USB power"));
  } else {
    Serial.print(volts, 1);
    Serial.println(batteryLow ? F(" V  LOW - please recharge") : F(" V  OK"));
  }
}


// ---------------------------------------------------------------------
// 6. LINE FOLLOWING
// ---------------------------------------------------------------------

// Remember when the robot starts doing something new.
// Returns true at the moment the action changes.
bool setAction(byte newAction) {
  if (newAction == action) return false;
  action = newAction;
  actionSince = millis();
  return true;
}

// How long the robot has been doing the current action, in ms.
unsigned long timeInAction() {
  return millis() - actionSince;
}

// Inner wheel in a turn: stopped at first, backwards if the turn goes on (sharp bend).
int innerWheelSpeed() {
  if (timeInAction() < SHARP_AFTER_MS) {
    return TURN_INNER_SOFT;
  }
  return TURN_INNER_SHARP;
}

void stopRun(const char *reason) {
  brakeMotors();
  delay(200);                     // brake for a moment...
  drive(0, 0);                    // ...then switch the motors off
  running = false;
  digitalWrite(PIN_LED, LOW);

  Serial.print(F("Stopped: "));
  Serial.println(reason);
  Serial.print(F("Run time: "));
  Serial.print((millis() - runStartedAt) / 1000.0, 2);
  Serial.println(F(" s"));
  checkBattery();
}

void startRun() {
  digitalWrite(PIN_LED, HIGH);
  Serial.println(F("START pressed - starting in 1 second"));
  delay(START_DELAY_MS);

  drive(255, 255);                // kick: full power for a moment
  delay(KICK_MS);

  running = true;
  runStartedAt = millis();
  action = ACT_STRAIGHT;
  actionSince = millis();
  lineMemory = ACT_STRAIGHT;
  junctionCount = 0;
}

// Stop at a junction (only used when STOP_AT_JUNCTION is not 0).
void stopAtJunction() {
  brakeMotors();
  Serial.print(F("Junction "));
  Serial.print(junctionCount);
  Serial.println(F(" - stopping"));
  if (JUNCTION_WAIT_MS == 0) {
    stopRun("stopped at the junction");
    return;
  }
  delay(JUNCTION_WAIT_MS);
  actionSince = millis();         // the wait does not count as "black for a long time"
}

// Spin on the spot: inner wheel backwards, outer wheel forwards.
void spin(bool toLeft) {
  if (toLeft) {
    drive(TURN_INNER_SHARP, TURN_OUTER);
  } else {
    drive(TURN_OUTER, TURN_INNER_SHARP);
  }
}

// The heart of the program: read both sensors and decide what to do.
void followLine() {
  bool left  = sensorOnBlack(PIN_SENSOR_LEFT);
  bool right = sensorOnBlack(PIN_SENSOR_RIGHT);

  // What was the robot doing just before this reading?
  bool searching = (action == ACT_SEARCH_LEFT || action == ACT_SEARCH_RIGHT);
  bool sharpTurn = (action == ACT_LEFT || action == ACT_RIGHT) && timeInAction() >= SHARP_AFTER_MS;

  if (left && !right) {
    // BLACK | white : the line is under the left sensor -> turn left
    lineMemory = ACT_STRAIGHT;              // we can see the line: nothing to remember
    setAction(ACT_LEFT);
    drive(innerWheelSpeed(), TURN_OUTER);
  }
  else if (!left && right) {
    // white | BLACK : the line is under the right sensor -> turn right
    lineMemory = ACT_STRAIGHT;
    setAction(ACT_RIGHT);
    drive(TURN_OUTER, innerWheelSpeed());
  }
  else if (searching || (left && sharpTurn)) {
    // Spinning round a corner: either searching for a lost line, or both sensors
    // went black in the middle of a sharp turn (the robot is on top of a corner).
    // Keep spinning the same way until exactly one sensor sees the line.
    if (timeInAction() >= SEARCH_GIVE_UP_MS) {
      stopRun("line lost - could not find it again");
      return;
    }
    spin(action == ACT_LEFT || action == ACT_SEARCH_LEFT);
  }
  else if (!left && !right) {
    // white | white : the line is between the sensors (or in a gap) -> straight on
    if (sharpTurn) {
      lineMemory = action;                  // a sharp turn just ended: remember which way it went
    }
    setAction(ACT_STRAIGHT);
    if (lineMemory != ACT_STRAIGHT && timeInAction() >= LOST_AFTER_MS) {
      // LINE MEMORY: still no line LOST_AFTER_MS after a sharp turn, so the robot
      // must have shot past a sharp corner. Spin back the way it was turning.
      setAction(lineMemory == ACT_LEFT ? ACT_SEARCH_LEFT : ACT_SEARCH_RIGHT);
      lineMemory = ACT_STRAIGHT;
      spin(action == ACT_SEARCH_LEFT);
    } else {
      drive(SPEED_STRAIGHT, SPEED_STRAIGHT);
    }
  }
  else {
    // BLACK | BLACK : a crossing line or a junction -> keep going straight
    lineMemory = ACT_STRAIGHT;
    if (setAction(ACT_CROSSING)) {          // just arrived at a new junction
      junctionCount++;
      if (junctionCount == STOP_AT_JUNCTION) {
        stopAtJunction();
        return;
      }
    }
    if (STOP_AT_STOP_BOX && timeInAction() >= STOP_BOX_MS) {
      stopRun("stop box");
      return;
    }
    if (timeInAction() >= LIFTED_STOP_MS) {
      stopRun("both sensors saw black for 1 s (robot lifted?)");
      return;
    }
    drive(SPEED_CROSSING, SPEED_CROSSING);
  }

  if (DEBUG && millis() - lastDebugPrint >= 100) {
    lastDebugPrint = millis();
    Serial.print(left ? F("L:BLACK ") : F("L:white "));
    Serial.print(right ? F("R:BLACK  ") : F("R:white  "));
    if (action == ACT_STRAIGHT)      Serial.println(F("straight"));
    else if (action == ACT_LEFT)     Serial.println(F("turn left"));
    else if (action == ACT_RIGHT)    Serial.println(F("turn right"));
    else if (action == ACT_CROSSING) Serial.println(F("crossing"));
    else                             Serial.println(F("searching for the line"));
  }
}


// ---------------------------------------------------------------------
// 7. SETUP AND LOOP
// ---------------------------------------------------------------------
void setup() {
  pinMode(PIN_ENA, OUTPUT);
  pinMode(PIN_IN1, OUTPUT);
  pinMode(PIN_IN2, OUTPUT);
  pinMode(PIN_IN3, OUTPUT);
  pinMode(PIN_IN4, OUTPUT);
  pinMode(PIN_ENB, OUTPUT);
  drive(0, 0);                          // motors off straight away

  pinMode(PIN_SENSOR_LEFT, INPUT);
  pinMode(PIN_SENSOR_RIGHT, INPUT);
  pinMode(PIN_START, INPUT_PULLUP);     // the button connects D12 to GND
  pinMode(PIN_LED, OUTPUT);

  Serial.begin(115200);
  Serial.println(F("Line follower ready - put it on the line and press START"));
  checkBattery();
}

void loop() {
  if (!running) {
    // waiting: blink the LED (fast if the battery is low) and watch the button
    unsigned long blinkTime = batteryLow ? 100 : 500;
    digitalWrite(PIN_LED, (millis() / blinkTime) % 2 == 0 ? HIGH : LOW);
    if (startButtonPressed()) {
      startRun();
    }
    return;
  }

  if (startButtonPressed()) {           // START pressed again during a run
    stopRun("START pressed");
    return;
  }
  followLine();
}
