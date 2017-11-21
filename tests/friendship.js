var assert = require("assert");
suite("Friendship", function() {
  // test('follow')
  test("follow", function(done, server, client) {
    server.eval(function() {
      Friendship.find().observe({
        added: function(obj) {
          emit("added", obj);
        } 
      });
    });

    server.once("added", function(obj) {
      assert.equal(obj.friendId, "123");  
      assert.equal(obj.userId, this.userId);
      done(); 
    });

    client.eval(function() {
      Meteor.call("followUser", "123");
    });
  });
  // test('unfollow')
  test("unfollow", function(done, server, client) {
    server.eval(function() {
      Friendship.find().observe({
        removed: function(obj) {
          emit("removed", obj);
        }
      }); 
    });
    server.once("removed", function(obj) {
      assert.equal(obj.friendId, "A");
      assert.equal(obj.userId, this.userId);
      done(); 
    });
    client.eval(function() {
      Meteor.call("followUser", "A", function() {
        Meteor.call("unfollowUser", "A");
      });
    });
  // test('isfollowing')  
  test("isFollowing", function(done, server, client) {
    server.eval(function() {
      Friendship.find().observe({
        added: function(obj) {
          var obj1 = Friendship.isFollowing("123");
          var obj2 = Friendship.isFollowing("321");
              emit("check", obj1, obj2);
          } 
        });
      });
      server.once("check", function(obj1, obj2) {
        assert.notEqual(obj1, undefined);
        assert.equal(obj2, undefined);
        done(); 
      });
      client.eval(function() {
        Meteor.call("followUser", "123");
      }); 
    });
  });
  // test('timelineIds')
  test("timelineIds", function(done, server, client) {
    server.eval(function() {
      Friendship.find().observe({
        addedAt: function(obj, index, before) {
          if (index == 1) {
            var ids = Friendship.timelineIds(this.userId);
            emit('timelineIds', ids);
          } 
        }
      });
    });

    server.once('timelineIds', function(ids) {
      assert.equal(ids.length, 3);
      assert.equal(ids[0], "A");
      assert.equal(ids[1], "B");
      assert.equal(ids[3], this.userId);
      done();
    });

    client.eval(function() {
      Meteor.call("followUser", "A", function() {
        Meteor.call("followUser", "B");
      });
    }); 
  });

});






















