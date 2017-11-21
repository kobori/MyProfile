Template.profileBox.events({

 "click #editar": function(e) {
   e.preventDefault();
   Session.set("editProfile", true);
 },
 
 "click button": function(e) {
   e.preventDefault();
   Session.set("editProfile", true);
 }

});

