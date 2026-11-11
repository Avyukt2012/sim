// Robot simulator: runs the REAL LF3_Line_Follower sketch against a 2D model of the robot on a track.
//   sim <strokes.csv> <centre.csv> <trace.csv> <line_w> <sensor_spacing> <vmax> [quiet]
// Model: differential drive, each wheel a first-order lag towards a target speed set by the L298N
// pin states (PWM dead zone included), digital IR sensors that read HIGH over black.
#include "arduino_mock.h"
#include <vector>
#include <cstdlib>
#include <cstring>
MockSerial Serial;

#ifndef SKETCH
#define SKETCH "../code/LF3_Line_Follower/LF3_Line_Follower.ino"
#endif
#include SKETCH

struct Pt { double x, y; };
static std::vector<std::vector<Pt>> strokes;   // black tape pieces
static std::vector<Pt> centre;                 // continuous centre line (through the gap) for progress
static std::vector<double> centreS;

// ---- parameters
static double LINE_W = 0.025, SPACING = 0.038, AHEAD = 0.07, WHEEL_TRACK = 0.13;
static double VMAX = 0.50, DEAD = 60, TAU = 0.08, TAU_BRAKE = 0.02, TAU_COAST = 0.06;
static const double STEP_US = 500;             // world step = one loop() call
static const double PRESS_AT = 0.30, PRESS_LEN = 0.15;   // simulated START press (s)
static const double VBAT = 7.6;

// ---- state
static double T_US = 0;
static int pinState[20], pwmDuty[20];
static double rx = 0, ry = 0, th = 0, vl = 0, vr = 0;
static FILE *trace = nullptr;
static double nextTrace = 0;
static double progress = 0, maxDev = 0, devSum = 0; static long devN = 0;
static int finished = 0;   // 1 = completed, -1 = failed
static const char *failWhy = "";
static double finishTime = 0;

static bool onLine(double px, double py) {
    const double hw = LINE_W / 2, hw2 = hw * hw;
    for (auto &s : strokes) {
        for (size_t i = 0; i + 1 < s.size(); i++) {
            const Pt &a = s[i], &b = s[i + 1];
            if (fabs(px - a.x) > 0.03 || fabs(py - a.y) > 0.03) continue;
            double dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy;
            double t = ((px - a.x) * dx + (py - a.y) * dy) / L2;
            if (t >= 0 && t <= 1) {
                double cx = a.x + t * dx - px, cy = a.y + t * dy - py;
                if (cx * cx + cy * cy <= hw2) return true;
            }
            if (i > 0) {   // round join at interior points (butt ends at the ends of each piece)
                double ex = a.x - px, ey = a.y - py;
                if (ex * ex + ey * ey <= hw2) return true;
            }
        }
    }
    return false;
}

static void sensorPos(int side, double &sx, double &sy) {   // side +1 = left, -1 = right
    double c = cos(th), s = sin(th);
    sx = rx + AHEAD * c - side * (SPACING / 2) * s;
    sy = ry + AHEAD * s + side * (SPACING / 2) * c;
}

// ---- Arduino API
void pinMode(uint8_t, uint8_t) {}
void digitalWrite(uint8_t p, uint8_t v) { pinState[p] = v; if (p == 3 || p == 11) pwmDuty[p] = v ? 255 : 0; }
void analogWrite(uint8_t p, int v) { pwmDuty[p] = v; }
unsigned long millis() { return (unsigned long)(T_US / 1000.0); }
int analogRead(uint8_t p) { return p == A5 ? (int)(VBAT / 3.2 * 1023.0 / 5.0) : 0; }
int digitalRead(uint8_t p) {
    double sx, sy;
    if (p == A1) { sensorPos(+1, sx, sy); return onLine(sx, sy) ? HIGH : LOW; }
    if (p == A3) { sensorPos(-1, sx, sy); return onLine(sx, sy) ? HIGH : LOW; }
    if (p == 12) { double t = T_US / 1e6; return (t >= PRESS_AT && t < PRESS_AT + PRESS_LEN) ? LOW : HIGH; }
    return LOW;
}

static double wheelTarget(int en, int a, int b, double &tau) {
    int duty = pwmDuty[en];
    if (pinState[a] != pinState[b]) {
        double eff = duty <= DEAD ? 0 : (duty - DEAD) / (255 - DEAD);
        tau = TAU;
        return (pinState[a] ? 1 : -1) * VMAX * eff;
    }
    tau = duty > 0 ? TAU_BRAKE : TAU_COAST;   // both IN pins equal: brake (EN on) or coast (EN off)
    return 0;
}

static void checkProgress() {
    // nearest centre-line point to the sensor midpoint, searched near the current progress
    double mx = rx + AHEAD * cos(th), my = ry + AHEAD * sin(th);
    double best = 1e9, bestS = progress;
    for (size_t i = 0; i < centre.size(); i++) {
        if (centreS[i] < progress - 0.25 || centreS[i] > progress + 0.25) continue;
        double d = hypot(centre[i].x - mx, centre[i].y - my);
        if (d < best) { best = d; bestS = centreS[i]; }
    }
    if (bestS > progress) progress = bestS;
    if (running) {
        if (best > maxDev) maxDev = best;
        devSum += best; devN++;
    }
    double total = centreS.back();
    if (progress >= total - 0.01) { finished = 1; finishTime = (T_US / 1e6) - runStartedAt / 1000.0; }
    else if (best > 0.10) { finished = -1; failWhy = "left the track"; }
    else if (T_US > 60e6) { finished = -1; failWhy = "timeout"; }
    else if (T_US > 2e6 && !running) { finished = -1; failWhy = "program stopped"; }
}

static void advance(double us) {
    for (double done = 0; done < us && !finished; done += STEP_US) {
        double dt = STEP_US / 1e6, tl, tr;
        double gl = wheelTarget(3, 4, 5, tl), gr = wheelTarget(11, 6, 7, tr);
        vl += (gl - vl) * dt / tl;
        vr += (gr - vr) * dt / tr;
        double v = (vl + vr) / 2, w = (vr - vl) / WHEEL_TRACK;
        th += w * dt;
        rx += v * cos(th) * dt;
        ry += v * sin(th) * dt;
        T_US += STEP_US;
        if (T_US >= nextTrace) {
            nextTrace += 5000;
            double lx, ly, qx, qy;
            sensorPos(+1, lx, ly); sensorPos(-1, qx, qy);
            if (trace) fprintf(trace, "%.4f,%.5f,%.5f,%.5f,%d,%d,%d,%.3f,%.3f,%d\n", T_US / 1e6, rx, ry, th,
                               onLine(lx, ly), onLine(qx, qy), (int)action, vl, vr, (int)running);
            if (fmod(T_US, 1000.0) < STEP_US) {}
        }
        if (fmod(T_US, 1000.0) < STEP_US / 2) checkProgress();
    }
}
void delay(unsigned long ms) { advance(ms * 1000.0); }

static void loadCSV(const char *fn, bool isStrokes) {
    FILE *f = fopen(fn, "r");
    if (!f) { perror(fn); exit(2); }
    char line[256];
    int last = -1;
    while (fgets(line, sizeof line, f)) {
        if (isStrokes) {
            int id; double x, y;
            if (sscanf(line, "%d,%lf,%lf", &id, &x, &y) != 3) continue;
            if (id != last) { strokes.push_back({}); last = id; }
            strokes.back().push_back({x, y});
        } else {
            double x, y, s;
            if (sscanf(line, "%lf,%lf,%lf", &x, &y, &s) != 3) continue;
            centre.push_back({x, y}); centreS.push_back(s);
        }
    }
    fclose(f);
}

int main(int argc, char **argv) {
    if (argc < 7) { fprintf(stderr, "usage\n"); return 2; }
    loadCSV(argv[1], true);
    loadCSV(argv[2], false);
    trace = fopen(argv[3], "w");
    LINE_W = atof(argv[4]); SPACING = atof(argv[5]); VMAX = atof(argv[6]);
    if (getenv("AHEAD")) AHEAD = atof(getenv("AHEAD"));          // sensor distance ahead of the wheels
    if (getenv("TAU")) TAU = atof(getenv("TAU"));                // motor response time
    if (getenv("DEAD")) DEAD = atof(getenv("DEAD"));             // PWM below this does not move the wheel
    if (getenv("TRACKW")) WHEEL_TRACK = atof(getenv("TRACKW"));  // distance between the wheels
    Serial.quiet = (argc > 7);
    // start pose: sensors straddling the line, 8 cm before the start of the track
    th = atan2(centre[1].y - centre[0].y, centre[1].x - centre[0].x);
    rx = centre[0].x - AHEAD * cos(th); ry = centre[0].y - AHEAD * sin(th);
    if (trace) fprintf(trace, "t,x,y,th,L,R,action,vl,vr,running\n");
    setup();
    while (!finished) { loop(); advance(STEP_US); }
    printf("RESULT %s lap=%.2fs mean_dev=%.1fmm max_dev=%.1fmm junctions_counted=%d progress=%.2f/%.2fm %s\n",
           finished > 0 ? "FINISHED" : "FAILED", finished > 0 ? finishTime : 0.0,
           devN ? 1000 * devSum / devN : 0.0, 1000 * maxDev, junctionCount, progress, centreS.back(),
           finished > 0 ? "" : failWhy);
    if (trace) fclose(trace);
    return finished > 0 ? 0 : 1;
}
